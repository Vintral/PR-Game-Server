/*var mysql = require( 'mysql2/promise' );
import logger from './logger';

var	EventEmitter = require( "events" ).EventEmitter;

class Database extends EventEmitter {
	constructor() {
		super();
		
		this._debug = true;
		/*this.database = mysql.createPool( {
			host : '104.236.71.139',
			connectionLimit: 125,
			queueLimit: 0,
			user : 'temp',			
			password : 't3mp',
			database : 'temp',
			debug : false
		} );
		
		this.database = mysql.createPool( {
            //host : 'pocket-realm.ctwbpohhunlz.us-west-1.rds.amazonaws.com',
            host: "127.0.0.1",
			connectionLimit: 125,
			queueLimit: 0,
			user : 'pocketrealm',			
			password : 'r2Ymv3FCHqXhSU54!',
			database : 'PocketRealm',
			debug : false
		} )
		
		this.database.on( 'acquire', this.onAcquired );
		this.database.on( 'connection', this.onConnection );
		this.database.on( 'enqueue', this.onEnqueued );
		this.database.on( 'release', this.onReleased );		
		this.database.on( 'test', this.onConnection );			
		
		this.debug( "Created" );
	}	
	
	dump() {
		console.log( "All: : " + this.database.pool._allConnections._list.length + "  Free: " + this.database.pool._freeConnections._list.length );
	}
	
	onAcquired() {
		logger.logDatabase( "onAcquired" );
	}
	
	onConnection() {		
		logger.logDatabase( "onConnection" );
	}
	
	onEnqueued() {
		logger.logDatabase( "onEnqueued" );
	}
	
	onReleased() {
		logger.logDatabase( "onReleased" );
	}
	
	async beginTransaction() {
		let connection = await this.database.getConnection();
		await connection.beginTransaction();
		return connection;
	}
	
	async getConnection( $callback ) {
		var self = this;
		
		logger.logError( "SHOULD NOT BE CALLED" );
		
		const connection = await this.database.getConnection();
		return connection;		
		
		/*this.database.getConnection( function( err, connection ){
			if( err ) {
				logger.logError( "Connecting to Database: " + err );			
				//response.json( { "code" : 100, "status" : "Error in connection database" } );
				return;
			} else {							
				if( $callback ) $callback( connection );
				else self.emit( "CONNECTION", connection );
								
				return connection;
			}
		} );
	}
	
	async commit( $connection ) {
		this.debug( "commit" );
		
		if( $connection ) {
			await $connection.commit();
			await $connection.release();
		}
	}
	
	async rollback( $connection ) {
		this.debug( "rollback" );
		
		if( $connection ) {
			$connection.rollback();
			$connection.release();
		}
	}
	
	async getOne( $query ) {		
		const data = await this.get( $query );
		return data[ 0 ];
	}
	
	async get( $query ) {
		this.debug( "Get: " + $query );
		const data = await this.database.query( $query );
		return data[ 0 ];
	}
	
	async execute( $query ) {
		this.debug( "Execute: " + $query );
		const result = await this.database.query( $query );
		return result[ 0 ];
	}
	
	async executeQuery( $query, $callback, $connection ) {
		console.log( "Acquiring: " + $query );		
		var self = this;
	
		if( !$connection ) {			
			/*this.database.query( $query, function( err, rows) {
				//console.log( "All: : " + self.database._allConnections.length + "  Free: " + self.database._freeConnections.length );
				if( err ) {
					console.log( "ERROR: " + err );					
				}
				if( $callback ) $callback( rows );
			} );
			
			const connection = await this.getConnection();
			if( connection ) {
				const result = await connection.query( $query );
				connection.release();
				
				console.log( results );
			}
			
			
			/*var connection = this.getConnection( function( connection ) {;
				if( connection ) {										
					connection.query( $query, function( err, rows ) {
						connection.release();
						//console.log( "Releasing: " + $query );
						//self.debug( "Released Connection" );
						if( $callback ) $callback( rows );
					} );
				} else logger.logError( "Database: No Connection Retrieved!" );
			} );
		} else {					
			$connection.query( $query, function( err, rows ) {
				if( $callback ) $callback( rows );
			} )
		}

	}
	
	close() {
		this.debug( "close" );
		
		console.log( "KILL" );
		this.database.end( function( err ) {
			if( err ) console.log( "Error Killing Pool: " + err );
		} );
	}
	
	debug( $msg ) {
		if( this._debug )
			logger.logDatabase( $msg );
	}
}

module.exports = new Database();*/

import * as mysql from 'mysql2/promise';
import chalk from 'chalk';
import logger from './logger';

import dotenv from "dotenv";
import { JSONObject } from './interfaces';
dotenv.config();

class Database {
  private readonly _debug:boolean;
  public pool:any;

  constructor() {
    this._debug = false;
    this.debug( "Created" );

    const options:JSONObject = {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT as unknown as number,
      connectionLimit: process.env.DB_CONNECTION_LIMIT as unknown as number,
    }; 
    this.pool = mysql.createPool( options );
    console.log( options );

    this.addListeners();
    this.build();
  }

  async connect():Promise<any> {
    this.debug( "connect" );

    let connection = await this.pool.getConnection();
    return connection;
  }

  async query( query:string, params?:Array<any>, debug?:boolean):Promise<any> {
    this.debug( "Query: " + query, debug || false );

    if( !params ) params = [];
    try{
        let ret = await this.pool.query( query, params );
        this.debug( "Query Done: " + query, debug || false );
        return ret;
    } catch( err ) {
        logger.logError( err );
        console.log( 'DATABASE ERROR' );
        console.log( err );
    }
  }

  async getConnection():Promise<any> {
    logger.logDatabase( 'getConnection' );

    const connection:any = await this.pool.getConnection();
    return connection;
  }

  async getOne( query:string, params?:Array<any> ):Promise<mysql.RowDataPacket> {
    if( !params ) params = [];
    const data:mysql.RowDataPacket = await this.get( query, params );
    return data[ 0 ];
  }

  async get( query:string, params?:Array<any> ):Promise<any> {
    if( !params ) params = [];
    this.debug( "Get: " + query );

    try{ 
      const data:mysql.RowDataPacket[] = await this.pool.query( query, params );
      return data[ 0 ];
    } catch( err ) {
      logger.logError( err );
      console.log( 'DATABASE ERROR' );
      console.log( err );
    }    
  }

  async build():Promise<any> {
    this.debug( "build" );

    /*const queries = [
      "CREATE DATABASE IF NOT EXISTS ledger_db",
      "CREATE TABLE IF NOT EXISTS `wallets` ( `id` int(10) unsigned NOT NULL AUTO_INCREMENT, `userid` int(10) unsigned NOT NULL, `provider` int(11) NOT NULL DEFAULT '0', `currency` varchar(32) NOT NULL, PRIMARY KEY (`id`), KEY `USERID_CURRENCY` (`userid`,`currency`) ) ENGINE=InnoDB AUTO_INCREMENT=274 DEFAULT CHARSET=latin1;",
      "CREATE TABLE IF NOT EXISTS `subwallets` ( `id` int(10) unsigned NOT NULL AUTO_INCREMENT, `wallet` int(10) unsigned NOT NULL, `account` varchar(32) NOT NULL DEFAULT '0', `balance` decimal(10,4) DEFAULT '0.0000', `default` int(1) NOT NULL DEFAULT '0', `token` varchar(45) DEFAULT NULL, `limit_check` int(1) DEFAULT '1', PRIMARY KEY (`id`), KEY `WALLET_idx` (`wallet`), CONSTRAINT `WALLET` FOREIGN KEY (`wallet`) REFERENCES `wallets` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION ) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=latin1;",
      "CREATE TABLE IF NOT EXISTS `providers` ( `id` int(10) unsigned NOT NULL AUTO_INCREMENT, `name` varchar(16) DEFAULT NULL, PRIMARY KEY (`id`) ) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=latin1;",
      "CREATE TABLE IF NOT EXISTS `transactions` ( `id` int(10) unsigned NOT NULL AUTO_INCREMENT, `wallet` int(11) DEFAULT NULL, `bet` varchar(45) DEFAULT NULL, `amount` int(10) DEFAULT NULL, `type` varchar(16) DEFAULT NULL, `data` blob, `date` datetime DEFAULT NULL, PRIMARY KEY (`id`) ) ENGINE=InnoDB AUTO_INCREMENT=24609 DEFAULT CHARSET=latin1;",
      "INSERT IGNORE INTO providers(id,name) VALUES (0,'none');",
      "INSERT IGNORE INTO providers(id,name) VALUES (1,'safecharge');",
      "INSERT IGNORE INTO providers(id,name) VALUES (2,'pay360');",
    ];

    for( let i = 0; i < queries.length; i++ ) {
      await this.query( queries[ i ] );
    }*/ 
  }

  async clear():Promise<void> {
    this.debug( "clear" );

    //await this.pool.query( 'DELETE FROM wallets WHERE id > 0' );
    //await this.pool.query( 'DELETE FROM transactions WHERE id > 0' );
  }

  async end():Promise<any> {
    this.debug( "end" );
    return this.pool.end();
  }

  addListeners():void {
    this.debug( "addListeners" );

    this.pool.on( 'connect', (_client: any) => this.debug( "Client Connected to pool" ) );
    this.pool.on( 'error', ( err:any, client:any ) => logger.logError( err ) ); 
  }

  debug( msg:string, force?:boolean, silence?:boolean ):void{
    if( silence ) return;
    if( this._debug || force )
      console.log( chalk.hex( '#00AA99' )( 'Database: ' + msg ) );
  }
}

let dbase = new Database();
export default dbase;