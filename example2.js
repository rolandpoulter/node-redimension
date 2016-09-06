'use strict';

const redis_client = require('./redis').client;
const Redimension = require('./redimension');

redis_client.del('people-by-salary').then(() => {
  let myindex = new Redimension(redis_client, 'people-by-salary', 2, 64);
  Promise.all([
    myindex.index([45, 120000], 'Josh'),
    myindex.index([50, 110000], 'Pamela'),
    myindex.index([41, 100000], 'George'),
    myindex.index([30, 125000], 'Angela')
  ]).then(() => {
    myindex.query([[40, 51], [90000, 115000]]).then(results => {
      console.log(results);
      myindex.unindex_by_id('Pamela').then(() => {
        console.log('removed Pamela');
        myindex.query([[40, 50], [90000, 115000]]).then(results => {
          console.log(results);
          myindex.update([42, 100000], 'George').then(() => {
            console.log('updated George');
            myindex.query([[40, 50], [90000, 115000]]).then(results => {
              console.log(results);
            });
          });
        });
      });
    });
  });
});
