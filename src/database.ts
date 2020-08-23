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
        const start = Date.now();    
        const data:mysql.RowDataPacket[] = await this.pool.query( query, params );
        console.log( query );
        console.log( "Took: " + ( Date.now() - start ) );
        return data[ 0 ];
    } catch( err ) {
      logger.logError( err );
      console.log( 'DATABASE ERROR' );
      console.log( err );
    }    
  }

  async build():Promise<any> {
    this.debug( "build" );
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