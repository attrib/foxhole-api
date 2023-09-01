const {WarApi} = require("./warapi")
const { voronoi } = require('d3-voronoi');
const uuid = require("uuid");
const mysql = require("./mysql");

const cachedData = {}

function wait(time) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, time)
  })
}

function initWar(shard, warId, warNumber) {
    return WarApi.maps(shard)
      .then((maps) => {
        let waitTimeout = 0
        const promises = []
        for (const mapId of maps) {
          promises.push(wait(waitTimeout)
            .then(() => WarApi.staticMap(shard, mapId))
            .then((data) => {
              const features = []
              const major = []
              for (const item of data.mapTextItems) {
                const feature = {
                  id: uuid.v4(),
                  x: item.x,
                  y: item.y,
                  iconType: item.mapMarkerType === 'Major' ? 0 : 1,
                  teamId: 'NONE',
                  flags: 0,
                  map: mapId,
                  shard: shard,
                  warId: warId,
                  text: item.text,
                }
                features.push(feature)
                if (item.mapMarkerType === 'Major') {
                  major.push(feature)
                }
              }
              const voronis = voronoi()
                .x(function (feature) {
                  return feature.x;
                })
                .y(function (feature) {
                  return feature.y;
                })
                .extent([
                  [-109199.999997, -94499.99999580906968410989],
                  [109199.999997, 94499.99999580906968410989],
                ])
                .polygons(major)
                .map((coords) => {
                  const data = coords['data']
                  delete coords['data']
                  return {
                    id: data.id,
                    coords: coords,
                    text: data.text,
                    warId: data.warId,
                    shard: data.shard,
                    map: data.map,
                  }
                })
              return mysql.execute(`INSERT INTO feature (id, x, y, iconType, teamId, flags, map, shard, warId, text) 
          VALUES (:id, :x, :y, :iconType, :teamId, :flags, :map, :shard, :warId, :text)
          ON DUPLICATE KEY UPDATE x = :x, y = :y, iconType = :iconType, teamId = :teamId, flags = :flags, map = :map, shard = :shard, warId = :warId, text = :text`,
                features
              )
                .then(() => mysql.execute(`INSERT INTO voroni (id, coords, text, warId, shard, map)
          VALUES (:id, :coords, :text, :warId, :shard, :map)
          ON DUPLICATE KEY UPDATE coords = :coords, text = :text, warId = :warId, shard = :shard, map = :map`, voronis))
                .then(() => {
                  return {
                    features,
                    voronis,
                    map: mapId
                  }
                })
            })
          )
          waitTimeout += 100
        }
        return Promise.all(promises)
      })
      .then((staticMapData) => {
        const promises = []
        let waitTimeout = 0
        for (const mapData of staticMapData) {
          promises.push(wait(waitTimeout)
            .then(() => WarApi.dynamicMapETag(shard, mapData.map))
            .then((data) => {
              const features = []
              for (const item of data.mapItems) {
                const feature = {
                  id: uuid.v4(),
                  x: item.x,
                  y: item.y,
                  iconType: item.iconType,
                  teamId: item.teamId,
                  flags: item.flags,
                  map: mapData.map,
                  shard: shard,
                  warId: warId,
                  text: WarApi.iconTypes[item.iconType]?.notes || '',
                }
                for (const voroni of mapData.voronis) {
                  if (inside(voroni.coords, [item.x, item.y])) {
                    feature.voroni = voroni.id
                    feature.text = `${voroni.text} ${feature.text}`
                    break
                  }
                }
                mapData.features.push(feature)
                features.push(feature)
              }
              return mysql.execute(`INSERT INTO feature (id, x, y, iconType, teamId, flags, map, shard, warId, text) 
          VALUES (:id, :x, :y, :iconType, :teamId, :flags, :map, :shard, :warId, :text)
          ON DUPLICATE KEY UPDATE x = :x, y = :y, iconType = :iconType, teamId = :teamId, flags = :flags, map = :map, shard = :shard, warId = :warId, text = :text`,
                features
              )
                .then(() => mapData)
            })
          )
          waitTimeout += 100
        }
        return Promise.all(promises)
      })
      .then((data) => {
        cachedData[warId] = {
          warId: warId,
          shard: shard,
          maps: data
        }
      })
      .then(() => mysql.query(`CALL dolt_add('feature', 'voroni')`))
      .then(() => mysql.query(`CALL dolt_commit('-m', 'Init war ${shard} ${warNumber}', '--skip-empty');`))
      .then(() => cachedData[warId])
}

function loadWar(shard, warId, warNumber) {
  return mysql.execute(`SELECT * FROM feature WHERE warId = :warId`, {warId})
    .then(([features]) => {
      if (features.length === 0) {
        return initWar(shard, warId, warNumber)
      }
      const mapData = {}
      for (const feature of features) {
        if (!(feature.map in mapData)) {
          mapData[feature.map] = {
            map: feature.map,
            features: [],
            voronis: [],
          }
        }
        mapData[feature.map].features.push(feature)
      }
      cachedData[warId] = {
        warId: warId,
        shard: shard,
        maps: Object.values(mapData)
      }
      return mysql.execute(`SELECT * FROM voroni WHERE warId = :warId`, {warId})
        .then(([voronis]) => {
          for (const voroni of voronis) {
            const mapData = cachedData[warId].maps.find((mapData) => mapData.map === voroni.map)
            if (mapData) {
              mapData.voronis.push(voroni)
            }
          }
          return cachedData[warId]
        })
    })
}

function updateWar(warId, shard) {
  if (!(warId in cachedData)) {
    throw new Error('Data not inside cache, load/init war first')
  }
  const promises = []
  let waitTimeout = 0
  for (const mapData of cachedData[warId].maps) {
    promises.push(wait(waitTimeout)
      .then(() => WarApi.dynamicMapETag(shard, mapData.map))
      .catch((err) => {
        if (err.response && err.response.status === 304) {
          return null
        }
        console.log(err)
        return null
      })
      .then((data) => {
        if (data === null) {
          return
        }
        if (data.error && data.error === 'Unknown mapId') {
          return
        }
        for (const item of data.mapItems) {
          let feature = mapData.features.find((compare) => {
            return compare.x === item.x && compare.y === item.y
          })
          if (!feature) {
            console.log(`New feature ${item.x} ${item.y} ${item.iconType} ${item.teamId} ${item.flags}`)
            feature= {
              id: uuid.v4(),
              x: item.x,
              y: item.y,
              iconType: item.iconType,
              teamId: item.teamId,
              flags: item.flags,
              map: mapData.map,
              shard: shard,
              warId: warId,
              text: WarApi.iconTypes[item.iconType]?.notes || '',
            }
            for (const voroni of mapData.voronis) {
              if (inside(voroni.coords, [item.x, item.y])) {
                feature.voroni = voroni.id
                feature.text = `${voroni.text} ${feature.text}`
                break
              }
            }
            mapData.features.push(feature)
          }
          feature.iconType = item.iconType
          feature.teamId = item.teamId
          feature.flags = item.flags
        }
        return mysql.execute(`INSERT INTO feature (id, x, y, iconType, teamId, flags, map, shard, warId, text) 
          VALUES (:id, :x, :y, :iconType, :teamId, :flags, :map, :shard, :warId, :text)
          ON DUPLICATE KEY UPDATE x = :x, y = :y, iconType = :iconType, teamId = :teamId, flags = :flags, map = :map, shard = :shard, warId = :warId, text = :text`,
          mapData.features
        )
      })
    )
    waitTimeout += 100
  }
  return Promise.all(promises)
    .then(() => mysql.query(`CALL dolt_add('feature')`))
    .then(() => mysql.query(`CALL dolt_commit('-m', 'Update ${shard} ${(new Date()).toISOString()}', '--skip-empty');`))
}

/**
 * https://stackoverflow.com/questions/22521982/js-check-if-point-inside-a-polygon
 * @param point
 * @param vs
 */
function inside(vs, point) {
  // ray-casting algorithm based on
  // https://wrf.ecse.rpi.edu/Research/Short_Notes/pnpoly.html

  const x = point[0], y = point[1];

  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    let xi = vs[i][0], yi = vs[i][1];
    let xj = vs[j][0], yj = vs[j][1];

    let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}


module.exports = {
  initWar,
  updateWar,
  loadWar,
}