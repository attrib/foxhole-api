CREATE DATABASE foxhole;

USE foxhole;

CREATE TABLE war (
  `warId` varchar(36) NOT NULL,
  `shard` varchar(20) NOT NULL,
  `warNumber` int NOT NULL,
  `winner` varchar(50) NOT NULL,
  `conquestStartTime` datetime,
  `conquestEndTime` datetime,
  `resistanceStartTime` datetime,
  `requiredVictoryTowns` int,
  `status` varchar(50),
  `VP_WARDENS` int,
  `VP_COLONIALS` int,
  `VP_REQUIRED` int,
  PRIMARY KEY (`warId`),
  UNIQUE KEY `warNumber` (`shard`, `warNumber`)
) DEFAULT CHARSET=utf8;

CREATE TABLE feature (
                     `id` varchar(36) NOT NULL,
                     `warId` varchar(36) NOT NULL,
                     `shard` varchar(20) NOT NULL,
                     `map` varchar(50) NOT NULL,
                     `x` double NOT NULL,
                     `y` double NOT NULL,
                     `iconType` int NOT NULL,
                     `teamId` varchar(50) NOT NULL,
                     `flags` int NOT NULL,
                     `text` varchar(100) NOT NULL,
                     PRIMARY KEY (`id`, `shard`, `warId`)
) DEFAULT CHARSET=utf8;

CREATE TABLE voroni (
                          `id` varchar(36) NOT NULL,
                          `warId` varchar(36) NOT NULL,
                          `shard` varchar(20) NOT NULL,
                          `map` varchar(50) NOT NULL,
                          `text` varchar(100) NOT NULL,
                          `coords` JSON NOT NULL,
                          PRIMARY KEY (`id`, `shard`, `warId`)
) DEFAULT CHARSET=utf8;


CALL dolt_add('war', 'feature', 'voroni');
CALL dolt_commit('-m', 'Initial commit');
