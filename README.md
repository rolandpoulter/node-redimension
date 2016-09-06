Redimension
===

Based on https://github.com/antirez/redimension

Redimension is a Redis multi-dimensional indexing and querying library
implemented in order to index items in N-dimensions, and then asking for elements
where each dimension is within the specified ranges.

Usage
===

Currently the library can index only unsigned integers of the specified
precision. There are no precision limits, you can index integers composed
of as much bits as you like: you specify the number of bits for each dimension
in the constructor when creating a Redimension object.

An example usage in 2D is the following. Imagine you want to index persons
by salary and age:

    myindex = new Redimension(redis_client, "people-by-salary", 2, 64)

We created a Redimension object specifying a Redis object that must respond
to the Redis commands. We specified we want 2D indexing, and 64 bits of
precision for each dimension. The first argument is the key name that will
represent the index as a sorted set.

Now we can add elements to our index.

    myindex.index([45,120000], "Josh")
    myindex.index([50,110000], "Pamela")
    myindex.index([30,125000], "Angela")

The `index` method takes an array of integers representing the value of each
dimension for the item, and an item name that will be returned when asking
for ranges during the query stage.

Querying is simple. In the following query we ask for all the people with
age between 40 and 50, and salary between 100000 and 115000.

    myindex.query([[40,50],[100000,115000]]).then(results => {
      console.log(results) // [50, 110000, "Pamela"]
    });

Ranges are **always** inclusive. Not a big problem since currently we can
only index integers so just increment/decrement to exclude a given value.

If you want to play with the library, the above example is shipped with
the source code, the file is called `example1.js`.

Unindexing
===

There are two ways in order to remove indexed data from the index. One
is to specify again the coordinates and the ID, using the `unindex` method:

    myindex.unindex([45,120000],"Josh")

However sometimes it is no longer possible to have the old data, we want
just unindex or update our coordinates for a given element. In this
case we may enable a feature of the library called *Hash mapping*. We
enable it by setting a key which will represent, using an Hash type, a
map between the item ID and the current indexed representation:

    myindex.hashkey = "people-by-salary-map"

Once this is enabled, each time we use the `index` method, an hash entry
will be created at the same time. We can now use two additional methods.
One will simply remove an item from the index just by ID:

    myindex.unindex_by_id("Josh")

The other is a variant of `index` that removes and re-adds the element with
the updated coordinates:

    myindex.update([46,120000],"Josh")

It is imporatnt to enable this feature after the object is created, and
consistently for all the queries, so that the Hash and the sorted set
are in sync. When this feature is enabled, to use `index` is not a good
idea and `update` should be used instead regardless the added element
areadly exists or not inside the index. Please refer to `example2.js` for
an example.

Tests
===

    npm test

License
===

The code is released under the BSD 2 clause license.
