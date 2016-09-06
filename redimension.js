'use strict';

function zip() {
  let rows = Array.from(arguments);
  return rows[0].map((_, c) => rows.map(row => row[c]));
}

function rjust(string, width, padding) {
	padding = padding || ' ';
	padding = padding.substr(0, 1);
	if (string.length < width) {
		return padding.repeat(width - string.length) + string;
  }
	return string;
}

function flatten(array, limit=Infinity, level=0) {
  return array.reduce((a, b) => {
    if (Array.isArray(b) && level < limit) {
      return a.concat(flatten(b, limit, level + 1));
    }
    a.push(b);
    return a;
  }, []);
};

exports = module.exports = class Redimension {
    constructor(redis, key, dim, prec=64) {
      this.debug = this.debug || false;
      this.redis = redis || redis_client;
      this.dim = dim;
      this.key = key;
      this.prec = prec;
      this.hashkey = this.hashkey || this.key + ':hash';
      this.binary = this.binary || false; // Default is hex encoding
    }

    check_dim(vars) {
      if (vars.length !== this.dim) {
        throw new Error(`Please always use ${this.dim} vars with this index.`);
      }
    }

    // Encode N variables into the bits-interleaved representation.
    encode(vars) {
      let comb = false;
      vars.forEach(v => {
        let vbin = rjust(v.toString(2), this.prec, '0');
        comb = comb ? zip(comb, vbin.split('')) : vbin.split('');
      });
      comb = flatten(comb).filter(v => v !== null && v !== undefined).join('');
      return rjust(parseInt(comb, 10).toString(16), this.prec * this.dim / 4, '0');
    }

    // Encode an element coordinates and ID as the whole string to add
    // into the sorted set.
    elestring(vars, id) {
      this.check_dim(vars);
      let ele = this.encode(vars);
      vars.forEach(v => {
        ele += `:${v}`;
      });
      return ele + `:${id}`;
    }

    // Add a variable with associated data 'id'
    index(vars, id) {
      let ele = this.elestring(vars, id);
      return this.redis.multi()
        .zadd(this.key, 0, ele)
        .hset(this.hashkey, id, ele)
        .exec();
    }

    // ZREM according to current position in the space and ID.
    unindex(vars,id) {
      return this.redis.zrem(this.key, this.elestring(vars, id));
    }

    // Unidex by just ID in case this.hashkey is set to true in order to take
    // an associated Redis hash with ID -> current indexed representation,
    // so that the user can unindex easily.
    unindex_by_id(id) {
      return new Promise((resolve, reject) => {
        this.redis.hget(this.hashkey, id).then(ele => {
          this.redis.multi()
            .zrem(this.key, ele)
            .hdel(this.hashkey, id)
            .exec()
            .then(resolve, reject);
        }, reject);
      });
    }

    // Like #index but makes sure to remove the old index for the specified
    // id. Requires hash mapping enabled.
    update(vars, id) {
      let ele = this.elestring(vars, id);
      return new Promise((resolve, reject) => {
        this.redis.hget(this.hashkey, id).then(oldele => {
          this.redis.multi()
            .zrem(this.key, oldele)
            .hdel(this.hashkey, id)
            .zadd(this.key, 0, ele)
            .hset(this.hashkey, id, ele)
            .exec().then(resolve, reject);
        });
      });
    }

    // exp is the exponent of two that gives the size of the squares
    // we use in the range query. N times the exponent is the number
    // of bits we unset and set to get the start and end points of the range.
    query_raw(vrange, exp) {
      let vstart = [],
          vend = [];
      // We start scaling our indexes in order to iterate all areas, so
      // that to move between N-dimensional areas we can just increment
      // vars.
      vrange.forEach(r => {
        vstart.push(Math.round(r[0] / Math.pow(2, exp)));
        vend.push(Math.round(r[1] / Math.pow(2, exp)));
      });

      // Visit all the sub-areas to cover our N-dim search region.
      let ranges = [],
          vcurrent = vstart.slice(0),
          notdone = true;

      while (notdone) {
        // For each sub-region, encode all the start-end ranges
        // for each dimension.
        let vrange_start = [],
            vrange_end = [],
            i = 0;

        for (; i < this.dim; i += 1)  {
          vrange_start.push(vcurrent[i] * Math.pow(2, exp));
          vrange_end.push(vrange_start[i] | (Math.pow(2, exp) -1));
        }

        if (this.debug) {
          console.log(`Logical square ${
            JSON.stringify(vcurrent)} from ${
            JSON.stringify(vrange_start)} to ${
            JSON.stringify(vrange_end)}`);
        }

        // Now we need to combine the ranges for each dimension
        // into a single lexicographcial query, so we turn
        // the ranges it into interleaved form.
        let s = this.encode(vrange_start);

        // Now that we have the start of the range, calculate the end
        // by replacing the specified number of bits from 0 to 1.
        let e = this.encode(vrange_end);

        ranges.push([`[${s}:`, `[${e}:\xff`]);

        if (this.debug) {
          console.log(`Lex query: ${ranges[ranges.length - 1]}`)
        }

        // Increment to loop in N dimensions in order to visit
        // all the sub-areas representing the N dimensional area to
        // query.
        for (i = 0; i < this.dim; i += 1) {
          if (vcurrent[i] !== vend[i]) {
            vcurrent[i] += 1;
            break;
          } else if (i === this.dim - 1) {
            notdone = false; // Visited everything!
          } else {
            vcurrent[i] = vstart[i];
          }
        }
      }

      // Perform the ZRANGEBYLEX queries to collect the results from the
      // defined ranges. Use pipelining to speedup.
      return new Promise((resolve, reject) => {
        let pipeline = this.redis.pipeline();
        ranges.forEach(range => {
          pipeline.zrangebylex(this.key, range[0], range[1]);
        });
        pipeline.exec().then(allres => {
          // Filter items according to the requested limits. This is needed
          // since our sub-areas used to cover the whole search area are not
          // perfectly aligned with boundaries, so we also retrieve elements
          // outside the searched ranges.
          let items = [];
          allres.forEach(res => {
            let err = res[0];
            res = res[1];
            if (err) return console.error(err);
            if (!res) return;
            res.forEach(item => {
              if (!item) return;
              let fields = item.split(':'),
                  skip = false,
                  i = 0;
              for (; i < this.dim; i += 1) {
                if (
                  parseInt(fields[i + 1], 10) < vrange[i][0] ||
                  parseInt(fields[i + 1], 10) > vrange[i][1]
                ) {
                  skip = true;
                  break;
                }
              }
              if (skip) return;
              // console.log(' GOT HERE ', fields);
              items.push(
                // fields[1..-2].map{|f| f.to_i} + [fields[-1]]
                fields.slice(1, fields.length - 1)
                  .map(f => parseInt(f, 10))
                  .concat([fields[fields.length - 1]]));
            });
          });
          resolve(items);
        }, reject);
      });
    }

    // Like query_raw, but before performing the query makes sure to order
    // parameters so that x0 < x1 and y0 < y1 and so forth.
    // Also calculates the exponent for the query_raw masking.
    query(vrange) {
      this.check_dim(vrange)
        vrange = vrange.map(vr => {
          return vr[0] < vr[1] ? vr : [vr[1], vr[0]];
        });
        let deltas = vrange.map(vr => (vr[1] - vr[0]) + 1),
            delta = Math.min.apply(null, deltas),
            exp = 1;
        while (delta > 2) {
          delta /= 2;
          exp += 1;
        }
        // If ranges for different dimensions are extremely different in span,
        // we may end with a too small exponent which will result in a very
        // big number of queries in order to be very selective. This is most
        // of the times not a good idea, so at the cost of querying larger
        // areas and filtering more, we scale 'exp' until we can serve this
        // request with less than 20 ZRANGEBYLEX commands.
        //
        // Note: the magic "20" depends on the number of items inside the
        // requested range, since it's a tradeoff with filtering items outside
        // the searched area. It is possible to improve the algorithm by using
        // ZLEXCOUNT to get the number of items.
        while (true) {
          deltas = vrange.map(vr => {
            return (vr[1] / Math.pow(2, exp)) - (vr[0] / Math.pow(2, exp)) + 1;
          })
          let ranges = deltas.reduce((a, b) => a * b);
          if (ranges < 20) break;
          exp += 1;
        }
        return this.query_raw(vrange, exp);
    }

    // Similar to #query but takes just the center of the query area and a
    // radius, and automatically filters away all the elements outside the
    // specified circular area.
    query_radius(x, y, exp, radius) {
      // TODO:
    }
}
