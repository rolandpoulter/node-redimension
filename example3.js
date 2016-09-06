'use strict';

const redis_client = require('./redis').client;
const Redimension = require('./redimension');

redis_client.del('grid').then(() => {
  let myindex = new Redimension(redis_client, 'grid', 2, 64);
  Promise.all([
    myindex.index([ 0,  0], 'One'),
    myindex.index([10, 10], 'Two'),
    myindex.index([20, 20], 'Three'),
    myindex.index([30, 30], 'Four'),
    myindex.index([40, 40], 'Five'),
    myindex.index([50, 50], 'Six'),
    myindex.index([60, 60], 'Seven'),
    myindex.index([70, 70], 'Eight'),
    myindex.index([80, 88.9], 'Nine'),
    myindex.index([90, 90], 'Ten')
  ]).then(() => {
    myindex.query([[9,89],[9,89]]).then(results => {
      console.log(results);
    });
  });
});
