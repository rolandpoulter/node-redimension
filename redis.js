'use strict';

const Redis = require('ioredis');

const redis_client = new Redis({
  port: 6379,
  host: '127.0.0.1',
  db: 0,
  keyPrefix: 'redim:'
});

exports.client = redis_client;
