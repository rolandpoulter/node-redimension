'use strict';

const redis_client = require('./redis').client;
const Redimension = require('./redimension');

function rand(max) {
  return Math.round(Math.random() * max);
}

function fuzzy_test(dim, items, queries) {
  return new Promise((testResolve, testReject) => {
    return redis_client.del('redim-fuzzy').then(() => {
      let rn = new Redimension(redis_client, 'redim-fuzzy', dim, 64),
          id = 0,
          dataset = [];
      let list = Array.from({length: 100}, (v, k) => {
        return new Promise((resolve, reject) => {
          let vars = Array.from({length: dim}, () => rand(1000));
          dataset.push(vars.concat(id.toString()));
          console.log(`Adding ${JSON.stringify(dataset[dataset.length - 1])}`);
          rn.index(vars, id).then(() => {
            resolve();
          }, reject);
          id += 1;
        })
      });
      Promise.all(list).then(() => {
        let list = Array.from({length: 100}, (v, k) => {
          let random = Array.from({length: dim}, () => {
            let s = rand(1000),
                e = rand(1000),
                t;
            if (s > e) {
              t = s;
              s = e;
              e = t;
            }
            return [s, e];
          });
          console.log(`TESTING ${JSON.stringify(random)}:`);
          let start_t = Date.now();
          return new Promise((resolve, reject) => {
            return rn.query(random).then(res1 => {
              // console.log(res1);
              let end_t = Date.now();
              console.log(`${res1.length} result in ${(end_t - start_t) / 1000} seconds\n`);
              let res2 = dataset.filter(i => {
                let included = true,
                    j = 0;
                for (; j < dim; j += 1) {
                  if (
                    i[j] < random[j][0] ||
                    i[j] > random[j][1]
                  ) {
                    included = false;
                  }
                }
                return included;
              });
              setTimeout(() => {
                res1 = res1.sort();
                res2 = res2.sort();
                if (res1.some((v, i) => res2[i].join(',') !== v.join(','))) {
                  console.log('COMPARISON FAILED');
                  console.log('res1', res1);
                  console.log('res2', res2);
                  return reject(new Error(`ERROR ${res1.length} VS ${res2.length}:`));
                }
                resolve();
              }, 50);
            }, reject);
          });
        });
        Promise.all(list).then(() => {
          console.log(`${dim}D test passed`);
          redis_client.del('redim-fuzzy').then(testResolve, testReject);
        }, testReject);
      }, testReject);
    }, testReject);
  });
}

const accept = () => {
  process.exit();
}
const reject = err => {
  console.error(err)
  process.exit();
}

fuzzy_test(4, 100, 1000).then(() => {
  fuzzy_test(3, 100, 1000).then(() => {
    fuzzy_test(2, 1000, 1000).then(accept, reject);
  }, reject);
}, reject);
