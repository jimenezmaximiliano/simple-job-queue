/**
 * @typedef {import('../types').Job}
 * @typedef {import('../helpers/getCurrentTimestamp').getCurrentTimestamp} GetCurrentTimestamp
 */

class Sqlite3Driver {
  #parseJobResult

  #getNewConnection

  #sharedConnection

  #setSharedConnection

  #run

  #getRow

  #reserveJob

  /** @type GetCurrentTimestamp */
  #getCurrentTimestamp

  /**
   * @param {Function} promisify
   * @param {GetCurrentTimestamp} getCurrentTimestamp
   * @param {Object} sqlite3
   * @param {string} fileName
   */
  constructor(promisify, getCurrentTimestamp, sqlite3, fileName) {
    this.#getCurrentTimestamp = getCurrentTimestamp;

    /**
     * @param {Object} result
     * @returns {Job|null}
     */
    this.#parseJobResult = (result) => {
      if (!result) {
        return null;
      }

      const job = result;
      job.payload = JSON.parse(job.payload);

      return job;
    };

    /**
     * @returns {Promise<Object>}
     */
    this.#getNewConnection = () => new Promise((resolve, reject) => {
      const newConnection = new sqlite3.Database(fileName, sqlite3.OPEN_READWRITE, (error) => {
        if (!error) {
          resolve(newConnection);
        }

        reject(error);
      });
    });

    /**
     * @param {string} query
     * @param {Object} params
     * @param {Object|null}connection
     * @returns {Promise<void>}
     */
    this.#run = async (query, params, connection = null) => {
      const connectionToUse = connection || this.#sharedConnection;
      const run = promisify(connectionToUse.run).bind(connectionToUse);
      await run(query, params);
    };

    /**
     * @param {string} query
     * @param {Object} params
     * @param {Object|null} connection
     * @returns {Promise<Object>}
     */
    this.#getRow = async (query, params, connection = null) => {
      const connectionToUse = connection || this.#sharedConnection;
      const get = promisify(connectionToUse.get).bind(connectionToUse);
      return get(query, params);
    };

    /**
     * @param {Object} connection
     * @param {string} selectQuery
     * @param {Object} params
     * @returns {Promise<Job|null>}
     */
    this.#reserveJob = async (connection, selectQuery, params) => {
      try {
        await this.#run('BEGIN EXCLUSIVE TRANSACTION;', {}, connection);
        const rawJob = await this.#getRow(selectQuery, params, connection);

        if (!rawJob) {
          await this.#run('COMMIT TRANSACTION;', {}, connection);
          return null;
        }

        const job = this.#parseJobResult(rawJob);
        const timestamp = this.#getCurrentTimestamp();
        await this.#run(`UPDATE jobs SET reserved_at = ${timestamp} WHERE uuid = "${job.uuid}"`, {}, connection);
        await this.#run('COMMIT TRANSACTION;', {}, connection);
        return job;
      } catch (error) {
        await this.#run('ROLLBACK TRANSACTION;', {}, connection);
        return null;
      }
    };

    this.#setSharedConnection = async () => {
      if (this.#sharedConnection) {
        return;
      }

      this.#sharedConnection = await this.#getNewConnection();
    };
  }

  /**
   * @returns {Promise<void>}
   */
  async createJobsDbStructure() {
    await this.#setSharedConnection();
    const query = 'CREATE TABLE IF NOT EXISTS jobs('
      + 'uuid TEXT PRIMARY KEY,'
      + 'queue TEXT NOT NULL,'
      + 'payload TEXT NOT NULL,'
      + 'created_at INTEGER NOT NULL,'
      + 'reserved_at INTEGER NULL,'
      + 'failed_at INTEGER NULL'
      + ')';

    await this.#run(query);
  }

  /**
   * @param {Job} job
   * @returns {Promise<void>}
   */
  async storeJob(job) {
    await this.#setSharedConnection();
    const query = 'INSERT INTO jobs(uuid, queue, payload, created_at) VALUES (?, ?, ?, ?)';

    await this.#run(query, [
      job.uuid,
      job.queue,
      JSON.stringify(job.payload),
      job.created_at,
    ]);
  }

  /**
   * @param {string} queue
   * @returns {Promise<Job|null>}
   */
  async getJob(queue) {
    const query = 'SELECT * FROM jobs WHERE queue = ? AND failed_at IS NULL AND reserved_at IS NULL LIMIT 1';
    const connection = await this.#getNewConnection();
    return this.#reserveJob(connection, query, [queue]);
  }

  /**
   * @param {string} jobUuid
   * @returns {Promise<Job|null>}
   */
  async getJobByUuid(jobUuid) {
    const query = 'SELECT * FROM jobs WHERE uuid = ? AND reserved_at IS NULL LIMIT 1';
    const connection = await this.#getNewConnection();

    return this.#reserveJob(connection, query, [jobUuid]);
  }

  /**
   * @param {string} queue
   * @returns {Promise<Job|null>}
   */
  async getFailedJob(queue) {
    const connection = await this.#getNewConnection();
    const query = 'SELECT * FROM jobs WHERE queue = ? AND failed_at IS NOT NULL AND reserved_at IS NULL LIMIT 1';

    return this.#reserveJob(connection, query, [queue]);
  }

  /**
   * @param {string} jobUuid
   * @returns {Promise<void>}
   */
  async deleteJob(jobUuid) {
    await this.#setSharedConnection();
    await this.#run('DELETE FROM jobs WHERE reserved_at IS NOT NULL AND uuid = ?', [jobUuid]);
  }

  /**
   * @param {string} jobUuid
   * @returns {Promise<void>}
   */
  async markJobAsFailed(jobUuid) {
    const timestamp = this.#getCurrentTimestamp();
    await this.#setSharedConnection();
    await this.#run('UPDATE jobs SET failed_at = ?, reserved_at = NULL WHERE uuid = ?', [timestamp, jobUuid]);
  }
}

module.exports = Sqlite3Driver;
