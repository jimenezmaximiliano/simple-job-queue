const util = require('util');
const sqlite3 = require('sqlite3');
const uuidGenerator = require('uuid').v4;
const redis = require('redis');
const RedLock = require('redlock');

const getCurrentTimestamp = require('./helpers/getCurrentTimestamp');
const QueueClient = require('./QueueClient');
const Sqlite3Driver = require('./drivers/Sqlite3Driver');
const RedisDriver = require('./drivers/RedisDriver');

/**
 * @class
 */
class VerySimpleQueue {
  /** @type {string[]} */
  #supportedDrivers

  /** @type {QueueClient} */
  #queueClient

  /**
   * VerySimpleQueue client constructor
   * @param {string} driverName - 'sqlite3' or 'redis'
   * @param {Sqlite3DriverConfig | Object} driverConfig -
   * Driver specific configuration
   * For redis see https://github.com/NodeRedis/node-redis#options-object-properties
   *
   * @example <caption>Sqlite3 driver</caption>
   * new VerySimpleQueue('sqlite3', { filePath: '/tmp/db.sqlite3' });
   * @example <caption>Redis driver</caption>
   * new VerySimpleQueue('redis', {});
   */
  constructor(driverName, driverConfig) {
    this.#supportedDrivers = ['sqlite3', 'redis'];

    if (!this.#supportedDrivers.includes(driverName)) {
      throw new Error('Driver not supported');
    }

    const drivers = {};

    drivers.sqlite3 = () => {
      if (driverConfig.filePath === ':memory:') {
        throw new Error(':memory: is not supported');
      }

      const driver = new Sqlite3Driver(
        util.promisify,
        getCurrentTimestamp,
        sqlite3,
        driverConfig,
      );
      this.#queueClient = new QueueClient(driver, uuidGenerator, getCurrentTimestamp);
    };

    drivers.redis = () => {
      const driver = new RedisDriver(
        util.promisify,
        getCurrentTimestamp,
        redis,
        driverConfig,
        RedLock,
      );

      this.#queueClient = new QueueClient(driver, uuidGenerator, getCurrentTimestamp);
    };

    drivers[driverName]();
  }

  /**
   * Creates the jobs table for SQL drivers and does nothing for redis
   *
   * @returns {Promise<void>}
   */
  async createJobsDbStructure() {
    await this.#queueClient.createJobsDbStructure();
  }

  /**
   * Push a new job to a queue
   *
   * @param {Object} payload - This the object that the handler is going to get
   * when you try to handle the job
   * @param {string} [queue=default] - Queue name
   * @returns {Promise<string>} - A promise of the created job's uuid
   *
   * @example
   * const jobUuid = verySimpleQueue.pushJob({ sendEmailTo: 'foo@foo.com' }, 'emails-to-send');
   */
  async pushJob(payload, queue = 'default') {
    return this.#queueClient.pushJob(payload, queue);
  }

  /**
   * Handle one job on the given queue
   * The job get's deleted if it doesn't fail and is marked a failed if it does
   *
   * @param {module:JobHandler} jobHandler - Function that will receive the payload
   * and handle the job
   * @param {string} [queue=default] - The queue from which to take the job
   * @returns {Promise<*>} - A promise of what the jobHandler returns
   *
   * @example
   * verySimpleQueue.handleJob((payload) => sendEmail(payload.email), 'emails-to-send');
   */
  async handleJob(jobHandler, queue = 'default') {
    return this.#queueClient.handleJob(jobHandler, queue);
  }

  /**
   * Handle a job by uuid
   * Same as handleJob but here you know which job you want to handle
   *
   * @param {module:JobHandler} jobHandler - Function that will receive the payload
   * and handle the job
   * @param {string} jobUuid - The job uuid that you've got when you pushed the job
   * @returns {Promise<*>} - A promise of what the jobHandler returns
   *
   * @example
   * verySimpleQueue.handleJobByUuid(
   *  (payload) => sendEmail(payload.email),
   *  'd5dfb2d6-b845-4e04-b669-7913bfcb2600'
   * );
   */
  async handleJobByUuid(jobHandler, jobUuid) {
    return this.#queueClient.handleJobByUuid(jobHandler, jobUuid);
  }

  /**
   * Handle a job that failed on a given queue
   *
   * @param {module:JobHandler} jobHandler - Function that will receive the payload
   * and handle the job
   * @param {string} [queue=default] - The queue from which to take the failed job
   * @returns {Promise<*>} - A promise of what the jobHandler returns
   *
   * @example
   * verySimpleQueue.handleFailedJob((payload) => tryAgain(payload.email), 'emails-to-send');
   */
  async handleFailedJob(jobHandler, queue = 'default') {
    return this.#queueClient.handleFailedJob(jobHandler, queue);
  }

  /**
   * Closes the connection to the database
   *
   * @returns {Promise<void>}
   */
  async closeConnection() {
    await this.#queueClient.closeConnection();
  }
}

module.exports = VerySimpleQueue;
