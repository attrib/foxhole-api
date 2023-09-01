const mysql = require('mysql2/promise');

/** @type {mysql.Connection} */
let connection;

async function connect() {
    connection = await mysql.createConnection({
        host: 'dolt',
        user: 'root',
        database: 'foxhole',
        namedPlaceholders: true,
    })
    await connection.connect();
}

async function query(sql, params = {}) {
    const [rows, fields] = await connection.query(sql, params);
    return rows;
}

/**
 *
 * @param sql
 * @param params
 * @returns {Promise<mysql.RowDataPacket, array>}
 */
function execute(sql, params = {}) {
    if (Array.isArray(params)) {
        return Promise.all(params.map((param) => connection.execute(sql, param)));
    }
    return connection.execute(sql, params);
}

module.exports = {
    connect,
    query,
    execute,
}