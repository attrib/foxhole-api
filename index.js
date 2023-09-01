const express = require('express');
const path = require('path');
const http = require('http');
const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const yaml = require('yaml');
const mysql = require('./services/mysql');

const app = express()

if (app.get('env') === 'production') {
    app.set('trust proxy', 2) // trust first two proxys (nginx, cloudflare)
}

app.use(express.static(path.join(__dirname, 'public'), {maxAge: 7200000}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', function (req, res) {
    res.redirect('/api-docs')
})

const swaggerDocument = yaml.parse(fs.readFileSync('public/openapi.yaml').toString())
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const port = Number.parseInt(process.env.PORT || '3000');
app.set('port', port);

mysql.connect().then(() => {
    console.log('Connected to database')

    const {Shards, WarApi} = require("./services/warapi");
    const {loadWar, updateWar} = require("./services/conquerUpdate");

    for (const shard of Object.values(Shards)) {
        WarApi.warDataUpdate(shard).then((data) => {
            if (data) {
                loadWar(shard, data.warId, data.warNumber)
                  .then(() => {
                      const updater = () => {
                          console.log(`[${(new Date).toISOString()}] Updating war data for ` + shard + '...')
                          updateWar(data.warId, shard)
                            .then((data) => {
                                console.log(`[${(new Date).toISOString()}] Finished war data for ` + shard + '...')
                                setTimeout(updater, 45000)
                            })
                      }
                      updater()
                  })
            }
        })
    }

    /**
     * Create HTTP server.
     */
    const server = http.createServer(app);

    server.listen(port);
    server.on('error', (error) => {
        if (error.syscall !== 'listen') {
            throw error;
        }

        const bind = 'Port ' + port

        // handle specific listen errors with friendly messages
        switch (error.code) {
            case 'EACCES':
                console.error(bind + ' requires elevated privileges');
                process.exit(1);
                break;
            case 'EADDRINUSE':
                console.error(bind + ' is already in use');
                process.exit(1);
                break;
            default:
                throw error;
        }
    });
    server.on('listening', () => {
        const addr = server.address();
        if (addr === null) {
            return
        }
        const bind = typeof addr === 'string'
            ? 'pipe ' + addr
            : 'port ' + addr.port;
        console.log('Listening on ' + bind);
    });
}).catch((e) => {
    console.log(e)
})
