-- MySQL dump 10.13  Distrib 8.0 (invented Acme sample, --no-data)
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8mb4 */;

DROP TABLE IF EXISTS `customer`;
CREATE TABLE `customer` (
  `customer_id` int unsigned NOT NULL AUTO_INCREMENT,
  `customer_name` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `segment` enum('standard','premium') DEFAULT 'standard',
  `note` text COMMENT 'it\'s a note; with a semicolon',
  `created` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`customer_id`),
  UNIQUE KEY `uq_customer_name` (`customer_name`),
  KEY `idx_segment` (`segment`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `order_line`;
CREATE TABLE `order_line` (
  `order_id` int NOT NULL,
  `line_no` int NOT NULL,
  `customer_id` int unsigned NOT NULL,
  `sku` varchar(40) NOT NULL,
  PRIMARY KEY (`order_id`,`line_no`),
  KEY `fk_line_customer` (`customer_id`),
  CONSTRAINT `fk_line_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer` (`customer_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
LOCK TABLES `customer` WRITE;
UNLOCK TABLES;
