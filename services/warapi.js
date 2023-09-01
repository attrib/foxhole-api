const mysql = require('./mysql')
const {EventEmitter} = require('events')

const WarStatus = {
    'WAR_IN_PROGRESS': 'ongoing',
    'WAR_RESISTANCE': 'resistance',
    'WAR_OVER': 'over'
}

module.exports.WarStatus = WarStatus

const Shards = {
    ABLE: 'Able',
    BAKER: 'Baker',
    CHARLIE: 'Charlie',
    DEV: 'Dev',
}

module.exports.Shards = Shards

const ShardsStatus = {
    UNKNOWN: 'unknown',
    LIVE: 'online',
}

module.exports.ShardsStatus = ShardsStatus

const shardConfig = {
    [Shards.ABLE]: {
        url: 'https://war-service-live.foxholeservices.com/api/',
    },
    [Shards.BAKER]: {
        url: 'https://war-service-live-2.foxholeservices.com/api/',
    },
    [Shards.CHARLIE]: {
        url: 'https://war-service-live-2.foxholeservices.com/api/',
    },
    [Shards.DEV]: {
        url: 'https://war-service-dev.foxholeservices.com/api/',
    }
}

class WarApi extends EventEmitter {

    static EVENT_WAR_UPDATED = 'warUpdated'
    static EVENT_WAR_ENDED = 'warEnded'
    static EVENT_WAR_PREPARE = 'warPrepareNext'

    eTags= {}

    shardData= {}

    constructor() {
        super();
        for (const shard of Object.values(Shards)) {
            mysql.execute('SELECT * FROM war WHERE shard = :shard ORDER BY warNumber DESC LIMIT 1', {shard})
              .then(([rows, fields]) => {
                if (rows.length > 0) {
                    this.shardData[shard] = rows[0]
                    this.shardData[shard].status = this.getWarStatus(this.shardData[rows[0].shard], true)
                    this.shardData[shard].shardStatus = ShardsStatus.UNKNOWN
                }
                else {
                    this.shardData[shard] = {
                        VP_COLONIALS: 0,
                        VP_REQUIRED: 32,
                        VP_WARDENS: 0,
                        conquestEndTime: null,
                        conquestStartTime: null,
                        requiredVictoryTowns: 32,
                        resistanceStartTime: null,
                        shard: shard,
                        shardStatus: ShardsStatus.UNKNOWN,
                        status: WarStatus.WAR_OVER,
                        warNumber: 0,
                        winner: 'NONE',
                        warId: ''
                    }
                }
              })
        }
    }

    getWarStatus = (data, active) => {
        const now = new Date()
        if (data.winner === 'NONE' && data.conquestStartTime && now > data.conquestStartTime) {
            return WarStatus.WAR_IN_PROGRESS
        }
        if (data.conquestEndTime && data.conquestEndTime > now && active) {
            return WarStatus.WAR_RESISTANCE
        }
        return WarStatus.WAR_OVER
    }

    warDataUpdate = (shard) => {
        return this.war(shard)
            .then((data) => {
                console.log('fetched war data for ' + shard, data)
                if (data) {
                    const warData = {
                        VP_COLONIALS: 0,
                        VP_REQUIRED: data.requiredVictoryTowns,
                        VP_WARDENS: 0,
                        conquestEndTime: data.conquestEndTime ? new Date(data.conquestEndTime) : null,
                        conquestStartTime: data.conquestStartTime ? new Date(data.conquestStartTime) : null,
                        requiredVictoryTowns: data.requiredVictoryTowns,
                        resistanceStartTime: data.resistanceStartTime ? new Date(data.resistanceStartTime) : null,
                        shard: shard,
                        shardStatus: ShardsStatus.LIVE,
                        status: WarStatus.WAR_OVER,
                        warNumber: data.warNumber,
                        winner: data.winner,
                        warId: data.warId
                    }
                    warData.status = this.getWarStatus(warData, true)
                    const currentWarData = this.shardData[shard]
                    // Buggy Api or already in preparation for next war
                    // Ignoring old war data now, waiting for API to reflect next war
                    if (currentWarData.warNumber > warData.warNumber) {
                        return
                    }
                    if (warData.warNumber > currentWarData.warNumber && warData.status === WarStatus.WAR_IN_PROGRESS) {
                        // We didn't prepare for this war!
                        if (currentWarData.status !== WarStatus.WAR_IN_PROGRESS) {
                            console.log('Not prepared for war. Preparing now.')
                            this.emit(WarApi.EVENT_WAR_PREPARE, {
                                newData: warData,
                                oldData: {...currentWarData},
                            })
                        }
                        console.log('A new war begins!')
                        this.eTags[shard] = {}
                        this.emit(WarApi.EVENT_WAR_UPDATED, {
                            newData: warData,
                            oldData: {...currentWarData},
                        })
                    }
                    else if (currentWarData.status === WarStatus.WAR_IN_PROGRESS && warData.status === WarStatus.WAR_RESISTANCE) {
                        console.log('War is over!')
                        this.emit(WarApi.EVENT_WAR_ENDED, {
                            newData: warData,
                            oldData: {...currentWarData},
                        })
                    }
                    else if ((currentWarData.status === WarStatus.WAR_RESISTANCE || currentWarData.status === WarStatus.WAR_IN_PROGRESS) && warData.status === WarStatus.WAR_OVER) {
                        console.log('War never ends!')
                        this.emit(WarApi.EVENT_WAR_PREPARE, {
                            newData: warData,
                            oldData: {...currentWarData},
                        })
                    }
                    else {
                        warData.VP_COLONIALS = currentWarData.VP_COLONIALS || 0
                        warData.VP_WARDENS = currentWarData.VP_WARDENS || 0
                        warData.VP_REQUIRED = currentWarData.VP_REQUIRED || warData.requiredVictoryTowns
                    }
                    this.shardData[shard] = warData

                    return mysql.execute(`INSERT INTO war (warId, shard, warNumber, winner, status, conquestStartTime, conquestEndTime, resistanceStartTime, requiredVictoryTowns, VP_WARDENS, VP_COLONIALS, VP_REQUIRED) 
                            VALUE (:warId, :shard, :warNumber, :status, :winner, :conquestStartTime, :conquestEndTime, :resistanceStartTime, :requiredVictoryTowns, :VP_WARDENS, :VP_COLONIALS, :VP_REQUIRED)
                            ON DUPLICATE KEY UPDATE winner = :winner, status = :status, conquestStartTime = :conquestStartTime, conquestEndTime = :conquestEndTime, resistanceStartTime = :resistanceStartTime, requiredVictoryTowns = :requiredVictoryTowns, VP_WARDENS = :VP_WARDENS, VP_COLONIALS = :VP_COLONIALS, VP_REQUIRED = :VP_REQUIRED
                            `, warData)
                      .then(() => {
                          return mysql.query(`CALL dolt_add('war')`)
                      })
                      .then(() => {
                          return mysql.query(`CALL dolt_commit('-m', 'Update war ${warData.shard} ${warData.warNumber}', '--skip-empty');`)
                      })
                      .then(() => {
                          return this.shardData[shard]
                      })
                }
                this.shardData[shard].shardStatus = ShardsStatus.UNKNOWN
            })
            .catch((e) => {
                console.log('error fetching war data', e)
            })
    }

    staticMap = (shard, hexId) => {
        return this.request(shard, 'worldconquest/maps/' + hexId + '/static');
    }

    dynamicMap = (shard, hexId) => {
        return this.request(shard, 'worldconquest/maps/' + hexId + '/dynamic/public');
    }

    war = (shard) => {
        return this.requestWithETag(shard, 'worldconquest/war');
    }

    maps = (shard) => {
        return this.request(shard, 'worldconquest/maps')
    }

    dynamicMapETag = (shard, hexId, version = null) => {
        if (version) {
            this.eTags[shard]['worldconquest/maps/' + hexId + '/dynamic/public'] = '"' + version + '"'
        }
        return this.requestWithETag(shard, 'worldconquest/maps/' + hexId + '/dynamic/public');
    }

    requestWithETag = (shard, path) => {
        return fetch(`${shardConfig[shard].url}${path}`, {
            headers: {
                'If-None-Match': this.eTags?.[shard]?.[path] || '',
                'Content-Type': 'application/json',
                'User-Agent': 'api.warden.express',
            }
        }).then((response) => {
            if (response.ok) {
                if (!(shard in this.eTags)) {
                    this.eTags[shard] = {}
                }
                this.eTags[shard][path] = response.headers.get('etag')
                return response.json()
            }
            return null
        });
    }

    request = (shard, path) => {
        return fetch(`${shardConfig[shard].url}${path}`, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'api.warden.express',
            }
        }).then((response) => {
            if (response.ok) {
                return response.json();
            }
            else {
                return null;
            }
        });
    }

    iconTypes = {
        11: {
            type: 'industry',
            icon: 'MapIconMedical',
            notes: 'Hospital',
        },
        12: {
            type: 'industry',
            icon: 'MapIconVehicle',
            notes: 'Vehicle Factory ',
        },
        15: {
            type: 'industry',
            icon: 'MapIconWorkshop',
            notes: 'Workshop',
        },
        16: {
            type: 'industry',
            icon: 'MapIconManufacturing',
            notes: 'Manufacturing Plant',
        },
        17: {
            type: 'industry',
            icon: 'MapIconManufacturing',
            notes: 'Refinery',
        },
        18: {
            type: 'industry',
            icon: 'MapIconShipyard',
            notes: 'Shipyard',
        },
        19: {
            type: 'industry',
            icon: 'MapIconTechCenter',
            notes: 'Tech Center',
        },
        33: {
            type: 'industry',
            icon: 'MapIconStorageFacility',
            notes: 'Storage Depot',
        },
        34: {
            type: 'industry',
            icon: 'MapIconFactory',
            notes: 'Factory',
        },
        36: {
            type: 'industry',
            icon: 'MapIconAmmoFactory',
            notes: 'Ammo Factory',
        },
        39: {
            type: 'industry',
            icon: 'MapIconConstructionYard',
            notes: 'Construction Yard',
        },
        51: {
            type: 'industry',
            icon: 'MapIconMassProductionFactory',
            notes: 'Mass Production Factory',
        },
        52: {
            type: 'industry',
            icon: 'MapIconSeaport',
            notes: 'Seaport',
        },
        53: {
            type: 'industry',
            icon: 'MapIconCoastalGun',
            notes: 'Coastal Gun',
        },


        27: {
            type: 'town',
            icon: 'MapIconFortKeep',
            notes: 'Keep',
            conquer: true,
        },
        28: {
            type: 'town',
            icon: 'MapIconObservationTower',
            notes: 'Observation Tower',
        },
        35: {
            type: 'town',
            icon: 'MapIconSafehouse',
            notes: 'Safehouse',
        },
        37: {
            type: 'town',
            icon: 'MapIconRocketSite',
            notes: 'Rocket Site',
        },
        45: {
            type: 'town',
            icon: 'MapIconRelicBase',
            notes: 'Small Relic Base',
            conquer: true,
        },
        46: {
            type: 'town',
            icon: 'MapIconRelicBase',
            notes: 'Medium Relic Base',
            conquer: true,
        },
        47: {
            type: 'town',
            icon: 'MapIconRelicBase',
            notes: 'Big Relic Base',
            conquer: true,
        },
        56: {
            type: 'town',
            icon: 'MapIconTownBaseTier1',
            notes: 'Town Hall',
            conquer: true,
        },
        57: {
            type: 'town',
            icon: 'MapIconTownBaseTier2',
            notes: 'Town Hall',
            conquer: true,
        },
        58: {
            type: 'town',
            icon: 'MapIconTownBaseTier3',
            notes: 'Town Hall',
            conquer: true,
        },

        59: {
            type: 'stormCannon',
            icon: 'MapIconStormCannon',
            notes: 'Storm Cannon',
        },
        60: {
            type: 'stormCannon',
            icon: 'MapIconIntelCenter',
            notes: 'Intel Center',
        },

        20: {
            type: 'field',
            icon: 'MapIconSalvageColor',
            notes: 'Salvage Field',
        },
        21: {
            type: 'field',
            icon: 'MapIconComponentsColor',
            notes: 'Component Field',
        },
        23: {
            type: 'field',
            icon: 'MapIconSulfurColor',
            notes: 'Sulfur Field',
        },
        32: {
            type: 'field',
            icon: 'MapIconSulfurMineColor',
            notes: 'Sulfur Mine',
        },
        38: {
            type: 'field',
            icon: 'MapIconSalvageMineColor',
            notes: 'Salvage Mine',
        },
        40: {
            type: 'field',
            icon: 'MapIconComponentMineColor',
            notes: 'Component Mine',
        },
        61: {
            type: 'field',
            icon: 'MapIconCoalFieldColor',
            notes: 'Coal Field',
        },
        62: {
            type: 'field',
            icon: 'MapIconOilFieldColor',
            notes: 'Oil Field',
        },
    }


}

module.exports.WarApi = new WarApi();