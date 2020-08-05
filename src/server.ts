//==================================//
//	Requires						//
//==================================//
//let net = require( 'net' );
const { promisify } = require( 'util' );
let UUID = require( 'uuid/v4' );
//let fs = require('fs');
//let validator = require('validator');
//import * as bcrypt from 'bcryptjs';
import chalk from 'chalk';
import { RowDataPacket } from 'mysql2/promise';
import dbase from './database';

const redis = require( 'redis' );

let CronManager = require( './crons' );

let UnitManager = require( './unit-manager' );
let BuildingManager = require( './building-manager' );
let ItemManager = require( './item-manager' );
let JobRewardManager = require( './job-reward-manager' );

const firebase = require( 'firebase-admin' );
const firebaseServiceAccount = require( '../serviceAccountKey.json' );

import dotenv from 'dotenv';
dotenv.config();

import logger from './logger';

import { UnitsProvider } from './providers';
import { RoundsController, UserController, ActionsController, LibraryController, UsersController, AvatarsController, EventsController, ChatsController, RankingsController, MarketsController, JobsController, CombatController, VaultController } from './controllers';

//==========================================//
//	Variables								//
//==========================================//
let port = 5523;
let totalUsers = 0;
const guid = UUID();
const rankRequests = [];

//==========================================//
//	Redis									//
//==========================================//
const redisListener = redis.createClient( process.env.REDIS_PORT, process.env.REDIS_HOST );
redisListener.on( "error", err => {
  logger.logError( "RedisError: " + err );
} );

redisListener.on( "ready", () => {
    logger.logServer( "Redis Ready" );        

  redisListener.subscribe( guid );
  redisListener.subscribe( "USER_MESSAGE" );
  redisListener.subscribe( "JOB_READY" );
  redisListener.subscribe( "JOBS_RETRIEVED" );
  redisListener.subscribe( "JOBS_CLEARED" );
  redisListener.subscribe( "JOB_CLAIMED" );
  redisListener.subscribe( "JOB_ERROR" );  
} );

redisListener.on( "connect", () => {
  logger.logServer( "Redis Connection Created" );
} );

redisListener.on( "message", async ( channel, message ) => {
  console.log( "Message: " + channel + ": " + message );

  let data = JSON.parse( message );
  
  switch( channel ) {
    case guid:
      console.log( "RECEIVED MESSAGE FOR US: " + message );
      switch( data.command ) {
        case 'GET_RANKINGS':
        case 'GET_TOP_RANKINGS': 
            _rankingsController.processResponse( data );          
            break; 
        case 'JOB_READY':
            if( users[ data.user ] ) {
                try {
                    users[ data.user ].connection.sendUTF( JSON.stringify( { type:'JOB_READY' } ) );
                } catch( err ) {
                    console.log( chalk.red( 'JOB ERROR' ) );
                    console.log( err );
                }
            } else {
                let packet:JSONObject = {};
                packet.server = guid;
                packet.userid = data.user;
                redisClient.publish( 'USER_OFFLINE', JSON.stringify( packet ) );
            }
            break;
        case 'JOBS':
            _jobsController.processResponse( data );
            break;
        case 'USER_ATTACKED': {
            console.log( 'USER ATTACKED' );
            console.log( data );
    
            if( users[ data.defender ] ) {
                //console.log( users[ data.defender ] );
                users[ data.defender ].user.update();
            }
        } break;            
        default: console.log( "UNKNOWN COMMAND: " + data.command ); break;
      }
      break;    
    case "USER_MESSAGE":
      if( users[ data.userid ] ) {
        users[ data.userid ].connection.emit( data.message );
      }
      break;
    case "JOB_READY":
      if( users[ data.userid ] ) {
        users[ data.userid ].connection.emit( "JOB_READY" );
      }
      break;
    case "JOBS_CLEARED":
      if( users[ data.userid ] ) {
        users[ data.userid ].connection.emit( "JOBS_CLEARED" );
      }
      break;
    case "JOBS_RETRIEVED":
      if( users[ data.userid ] ) {
        console.log( data );
        users[ data.userid ].connection.emit( "JOBS_RETRIEVED", data.data );
      }
      break;
    case "JOB_CLAIMED":
      if( users[ data.userid ] ) {
        console.log( data );
        let item = ItemManager.getItemByID( data.data );
        console.log( item );
        users[ data.userid ].connection.emit( "JOB_CLAIMED", data.data );
      }
      break;
    case "JOB_ERROR":
      logger.logError( data.message );
      break;
  } 
} );

const redisClient = redis.createClient( process.env.REDIS_PORT, process.env.REDIS_HOST );
const getAsync = promisify( redisClient.get ).bind( redisClient );
const setAsync = promisify( redisClient.set ).bind( redisClient );
const delAsync = promisify( redisClient.del ).bind( redisClient );
const decrAsync = promisify( redisClient.decrby ).bind( redisClient );
const incrAsync = promisify( redisClient.incrby ).bind( redisClient );

redisClient.on( "ready", () => {
  let obj:{ [key: string]: any } = {};
  obj.test = "123";
  obj.msg = "Hello World";
  redisClient.publish( "USER_MESSAGE", JSON.stringify( obj ) );

  obj = {};
  obj.to = "jeffrey.heater@gmail.com";
  obj.subject = "Email Subject";
  obj.body = "Body of Email";
  //redisClient.publish( "SEND_EMAIL", JSON.stringify( obj ) );

  redisClient.publish( guid, JSON.stringify( { msg:"HELLO THERE" } ) );  
} );

//==========================================//
//	Providers    							//
//==========================================//
const _unitsProvider:UnitsProvider = new UnitsProvider( redisClient );
_unitsProvider.load();

//==========================================//
//	Controllers 							//
//==========================================//
const _userController:UserController = new UserController( redisClient );
const _roundsController:RoundsController = new RoundsController();
const _actionsController:ActionsController = new ActionsController( _unitsProvider );
const _libraryController:LibraryController = new LibraryController();
const _usersController:UsersController = new UsersController();
const _avatarsController:AvatarsController = new AvatarsController();
const _eventsController:EventsController = new EventsController();
const _conversationsController:ChatsController = new ChatsController();
const _rankingsController:RankingsController = new RankingsController( redisClient );
const _marketsController:MarketsController = new MarketsController();
const _jobsController:JobsController = new JobsController( redisClient );
const _combatController:CombatController = new CombatController( _userController, _unitsProvider, redisClient );
const _vaultController:VaultController = new VaultController();

async function test():Promise<void> {
    let query:string = `DELETE FROM users_rounds_units WHERE id > 0`;
    let result:any = await dbase.query( query );

    let units = [
        { u:2, unit:1, quantity:20 },
        { u:2, unit:2, quantity:20 },
        { u:2, unit:3, quantity:20 },
        { u:2, unit:4, quantity:20 },
        { u:2, unit:5, quantity:20 },
        { u:3, unit:1, quantity:20 },
        { u:3, unit:2, quantity:20 },
        { u:3, unit:3, quantity:20 },
        { u:3, unit:4, quantity:20 },
        { u:3, unit:5, quantity:20 },
    ];

    units.forEach( async( unit ) => {
        await dbase.query( 'INSERT INTO users_rounds_units ( userid, roundid, unitid, quantity ) VALUES ( ?, 45, ?, ? )', [ unit.u, unit.unit, unit.quantity ] );
    } );

    await dbase.query( 'DELETE FROM users_rounds_buildings WHERE userid = 3' );
    await dbase.query( 'UPDATE users_rounds SET land = 200, land_free = 0 WHERE userid = 3' );
    let buildings = [
        { building:1, quantity:40 },
        { building:2, quantity:5 },
        { building:3, quantity:40 },
        { building:4, quantity:40 },
        { building:5, quantity:25 },
        { building:6, quantity:5 },
        { building:7, quantity:5 },
        { building:8, quantity:40 },
    ];
    buildings.forEach( async( building ) => {
        await dbase.query( 'INSERT INTO users_rounds_buildings ( userid, roundid, buildingid, quantity ) VALUES ( 3, 45, ?, ? )', [ building.building, building.quantity ] );
    } );

    let attacker:User|null = await _userController.load( 'vintral', 45 );
    if( attacker === null ) return;
    
    const fdata:JSONObject = {
        command:'attack',
        target:'trallara'
    };
    //_combatController.process( fdata, attacker );

    const rdata:JSONObject = {
        command:'raid',
        target:'trallara'
    };
    //_combatController.process( rdata, attacker );
}
test();

//==========================================//
//	Database								//
//==========================================//
//let database = require( './database' );
//logger.setDatabase( database );
// TO DO -- ADD THIS FUNCTIONALITY
/*HTTP.on( "UNITS_UPDATED", function() { UnitManager.Update(); } );
HTTP.on( "BUILDINGS_UPATED", function() { BuildingManager.Update(); } );
HTTP.on( "ITEMS_UPDATED", function() { ItemManager.Update(); } );
HTTP.on( "BANNED_USER", data => { if( users[ data.user ] ) users[ data.user ].connection.emit( "BANNED", { reason:data.reason, duration:data.duration, length:data.length } ); } );
HTTP.on( "MAILED_USER", user => { if( users[ user ] ) users[ user ].connection.emit( "NEW_MAIL" ); } );
HTTP.setDatabase( database );*/

//http.listen( port );
//console.log( "Server Started" );

//let bot = new Bot( 5, database );
//bot = new Bot( 6, database );
//let bot = new Bot( 7, database );

/*let user = new User();
user.database = database;
user.login( "vintral", "jeff" );*/

let users = {};

//HTTP.setUsersData( users );
//HTTP.setTotalUsers( 0 );

//==========================================//
//	Firebase								//
//==========================================//
firebase.initializeApp( {
  credential: firebase.credential.cert( firebaseServiceAccount ),
  databaseURL: 'https://pocket-realm.firebaseio.com'
} );

//==================================//
//	Closing Over-rides				//
//==================================//
process.stdin.resume(); //so the program will not close instantly

async function exitHandler( err:any, options?:any ):Promise<void> {
    console.trace( 'exitHandler' );
    
    console.log( options );
  if( options.cleanup ) {        
    //database.close();    
    let result = await decrAsync( 'USERS-ONLINE', totalUsers );
    if( result < 0 ) await setAsync( 'USERS-ONLINE', 0 );
    console.log( "Result: " + result );

    redisListener.quit();
  }  

  if( err ) console.log( err.stack );
  if( options.exit ) process.exit();
}

//do something when app is closing
process.on( 'exit', exitHandler.bind( null, null, { cleanup:true } ) );

//catches ctrl+c event
process.on( 'SIGINT', exitHandler.bind( null, null, { exit:true } ) );

//catches uncaught exceptions
process.on( 'uncaughtException', exitHandler.bind( null, { exit:true } ) );
process.on( "unhandledRejection", ( reason, p ) => {
  //console.log( "Unhandled Rejection at: Promise" + p + "reason:" + reason );  	
  console.log( reason );  
} );

process.on( "SIGTERM", () => {
  logger.logServer( "Shutting Down" );  
  exitHandler( null, { exit:true, cleanup:true } )   
} );

//==========================================//
//	Memory Watcher							//
//==========================================//
/*memory.on( 'leak', function( in fo ) {
  logger.logError( "Leak Detected: " + info.reason );
  console.log( info );
} );

let heap;
memory.on( 'stats', function( stats ) {
  logger.logServer( "Memory Snapshot: " + stats.usage_trend );
  
  if( heap ) {
    let diff = heap.end();		
    console.log( "Heap Change: " + diff.change.size );		
  }
  
  //heap = new memory.HeapDiff();
} );*/

//==============================//
//	Http Server                 //
//==============================//
import * as WebSocket from 'websocket';
import Round from './models/round';
import { JSONObject } from './interfaces';
import { User } from './models';
import http from 'http';

const httpServer = http.createServer( ( request, response ) => {
    //logger.logServer( ( new Date() ) + ' Received request for ' + request.url );    
    const date:Date = new Date();
    console.log( date.getHours() + ':' + date.getMinutes() + ':' + date.getSeconds() + ' - ' + request.headers[ 'x-forwarded-for' ] + ' - ' + request.url );
    response.writeHead( 502 );    
    response.end();
} );
httpServer.listen( port, function() {
    console.log( ( new Date() ) + ' Server is listening on port ' + port );
} );

const server = new WebSocket.server( {
    httpServer,
    autoAcceptConnections: true
} );

server.on( 'connect', ( connection:WebSocket.connection ) => {
    let user:User|null;
    let userid:number = -1;
    let token:string = '';
    let os:string = '';

    console.log( "WE HAVE CONNECTION" );    
    console.log( connection.remoteAddress );    

    connection.on( 'message', async payload => {
        console.log( 'RECEIVED MESSAGE' );
        let data = JSON.parse( payload.utf8Data as string );
        console.log( data );

        function send( packet:JSONObject ) {
            try {
                connection.sendUTF( JSON.stringify( packet ) );
            } catch( err ) {
                console.log( chalk.red( 'ERROR: ' + err ) );
            }
        }
        
        switch( data.command ) {
            case 'login_bot': {
                console.log( 'LOGIN BOT' );
                console.log( data );

                let result:RowDataPacket = await dbase.getOne( `SELECT username FROM users WHERE id = ?`, [ data.id ] );
                data.username = Buffer.from( result.username ).toString( 'base64' );
                data.password = Buffer.from( data.password ).toString( 'base64' );

                /*await dbase.query( 'UPDATE users SET current_round = 0 WHERE id = ?', [ data.id ] );
                await dbase.query( 'DELETE FROM users_rounds WHERE userid = ?', [ data.id ] );
                await dbase.query( 'DELETE FROM users_rounds_units WHERE userid = ?', [ data.id ] );
                await dbase.query( 'DELETE FROM users_rounds_buildings WHERE userid = ?', [ data.id ] );/* */

                const { username, password } = data;
                console.log( username );
                console.log( password );
                let tempUser:User|null = await _userController.login( username, password );
                if( tempUser == null ) return send( { type:'LOGIN_ERROR', data:'Invalid Username/Password' } );                
                
                user = tempUser;
                user.redis = redisClient;
                user.connection = connection;
                user.token = '';
                user.recordIP( connection.remoteAddress );                
                
                console.log( user.id );

                let bot_data:RowDataPacket = await dbase.getOne( 'SELECT * FROM users_bots1 WHERE bot = ?', [ user.id ] );
                console.log( bot_data );

                send( { type:'LOGIN_SUCCESS', data:{ user: user.trim(), bot: bot_data } } );

                users[ user.id ] = {
                    user,
                    connection
                };
                totalUsers++;                

                // Set this user's key to this server
                await setAsync( 'USER-' + user.id, guid );
                await incrAsync( 'USERS-ONLINE', 1 );

                const online:number = await getAsync( 'USERS-ONLINE' );
                console.log( 'ONLINE: ' + online );
            } break;
            case 'register': {
                console.log( 'Token: ' + token );
                let result:RowDataPacket = await dbase.getOne( `SELECT COUNT(id) AS total FROM users_push_tokens WHERE token = ?`, [ token ] );
                console.log( result );
                if( result && result.total >= 2 ) return send( { type:'ERROR', data:'registration-too-many' } );

                const d:JSONObject = await _userController.register( data );
                
                console.log( '========================' );
                console.log( d );
                console.log( d.type );
                console.log( '========================' );

                if( d.id !== null && d.id === -1 ) send( { type:'ERROR', data:'registration-generic' } );
                else if( d.type !== null && d.type === 'ERROR' ) send( d );
                else {
                    userid = d.id;
                    send( { type:'REGISTERED' } );
                }
            } break;
            case 'login': {
                console.log( 'LOGIN' );
                const { username, password } = data;
                console.log( username );
                console.log( password );
                let tempUser:User|null = await _userController.login( username, password );
                if( tempUser == null ) return send( { type:'LOGIN_ERROR', data:'Invalid Username/Password' } );
                console.log( 1 );

                let result:RowDataPacket = await dbase.getOne( `SELECT COUNT(id) AS total FROM users_push_tokens WHERE token = ? AND userid <> ?`, [ token, tempUser.id ] );
                if( result && result.total >= 2 ) return send( { type:'ERROR', data:{ code: 'login-too-many' } } );                

                user = tempUser;
                user.redis = redisClient;
                user.connection = connection;
                user.token = token;
                user.recordIP( connection.remoteAddress );
                _userController.recordPushToken( user, token, os );

                user.updateLastLogin();
                user.updateLastSeen();

                let check:boolean = await user.checkForDupes();
                if( check ) {
                    console.log( 'LOGGED IN' );
                    send( { type:'LOGIN_SUCCESS', data:user.trim() } );
                } else console.log( 'what da shit' );

                users[ user.id ] = {
                    user,
                    connection
                };
                totalUsers++;                

                // Set this user's key to this server
                await setAsync( 'USER-' + user.id, guid );
                await incrAsync( 'USERS-ONLINE', 1 );

                const online:number = await getAsync( 'USERS-ONLINE' );
                console.log( 'ONLINE: ' + online );

                let packet:JSONObject = {};
                packet.server = guid;
                packet.userid = user.id;
                redisClient.publish( 'USER_ONLINE', JSON.stringify( packet ) );
            } break;
            case 'register_push_token': {
                token = data.token;
                os = data.os;

                console.log( 'TOKEN: ' + token + '(' + os + ')' );
            } break;
            case 'recover_password': {
                send( await _userController.process( data ) );
            } break;
            case 'set_avatar':
            case 'get_avatars': {
                if( user != null ) send( await _avatarsController.process( data, user ) );
                else if( userid !== -1 ) {
                    switch( data.command ) {                    
                        case 'get_avatars': send( await _avatarsController.getAvatarsForUserID( userid ) ); break;
                        case 'set_avatar': send( await _avatarsController.setAvatarForUserID( data, userid ) ); break;
                    }
                }
            } break;
            case 'get_buildings':
            case 'get_units':
            case 'get_rules':
            case 'get_items':
            case 'get_news':
                send( await _libraryController.process( data ) );
                break;
            default: if( user != null ) {
                user.updateLastSeen();

                switch( data.command ) {        
                    case 'logout': {
                        delete users[ user.id ];
                        totalUsers--;
        
                        // Set this user's key to this server                
                        await delAsync( 'USER-' + user.id );
                        await decrAsync( 'USERS-ONLINE', 1 );
        
                        user = null;

                        return send( { type:'LOGOUT' } );
                    } break;
                    case 'get_rounds':
                    case 'join_round': 
                    case 'play_round': {
                        send( await _roundsController.process( data, user ) );
                    } break;
                    case 'gather':
                    case 'explore': 
                    case 'build': 
                    case 'recruit':
                    case 'fire_unit':
                    case 'destroy_building': {
                        send( await _actionsController.process( data, user ) );
                    } break;
                    case 'buy_premium_item':
                    case 'update_email':
                    case 'update_password':
                    case 'notifications_enabled':
                    case 'notification_setting':            
                    case 'get_user_data': {
                        send( await _userController.process( data, user ) );
                    } break;
                    case 'search_users':
                    case 'add_friend':
                    case 'remove_friend':
                    case 'add_enemy':
                    case 'remove_enemy':
                    case 'block':
                    case 'unblock':
                    case 'get_profile':
                    case 'get_contacts': {
                        send( await _usersController.process( data, user ) );
                    } break;
                    case 'clear_events':
                    case 'get_events': {
                        send( await _eventsController.process( data, user ) );
                    } break;            
                    case 'buy_item':
                    case 'sell_item':
                    case 'get_markets': {
                        send( await _marketsController.process( data, user ) );
                    } break;
                    case 'get_jobs': {
                        await _jobsController.process( data, user, guid, connection );
                    } break;
                    case 'contact':
                    case 'get_shouts':
                    case 'join_shoutbox':
                    case 'leave_shoutbox':
                    case 'get_conversation':
                    case 'get_conversations':
                    case 'send_message': {
                        send( await _conversationsController.process( data, user, connection ) );
                    } break;
                    case 'get_near_ranks':
                    case 'get_top_ranks': {
                        await _rankingsController.process( data, user, guid, connection );
                    } break;
                    case 'raid':
                    case 'attack':
                    case 'get_targets':
                    case 'get_fights': {
                        send( await _combatController.process( data, user ) );
                    } break;
                    case 'get_vault':
                    case 'use_item': {
                        send( await _vaultController.process( data, user ) );
                    } break;
                    default: 
                        console.log( chalk.white.bgRed( 'ERROR:' ) + chalk.red( ' Unhandled Command - ' + data.command ) );
                        break;
                }
            }
        }
    } );

    connection.on( 'close', async ( reason, description ) => {
        if( user ) {
            user.stop();
            delete users[ user.id ];            
            await delAsync( 'USER-' + user.id );
            await decrAsync( 'USERS-ONLINE', 1 );
            const online:number = await getAsync( 'USERS-ONLINE' );
            console.log( 'Online Users: ' + online );
            totalUsers--;
        }
    } );

    try {
        connection.sendUTF( JSON.stringify( { type: 'PING' } ) );
    } catch( err ) {
        console.log( chalk.red( 'CONNECTION ERROR' ) );
        console.log( err );
    }
} );

server.on( 'close', connection => {    
    console.log( "WE LOST CONNECTION" );
    //process.exit( 1 );
} );


//==================================//
//	Socket Control					//
//==================================//
/*io.on( 'connection', function( socket ) {	
  logger.logConnection( socket.handshake.headers[ 'x-real-ip' ] + ' connected' );
  
  socket.on( "LOGIN", function( data ) {		
    /*let username = Buffer.from( data.username, "base64" ).toString();
    let password = Buffer.from( data.password, "base64" ).toString();
    
    let token = data.token ? Buffer.from( data.token, "base64" ).toString() : this.token;
    let os = data.os ? Buffer.from( data.os, "base64" ).toString() : this.os;

    this.token = token;
    this.os = os;
    
    this.user = new User();		
    //this.user.database = database;
    //this.user.connection = this;
        
    //this.user.on( "LOGIN_FAIL", function() {
      socket.emit( "LOGIN_FAIL" );
    } );
    /*this.user.on( "LOGIN_SUCCESS", async() => {
      totalUsers++;
      logger.logServer( "Current Users: " + totalUsers );

      logger.logServer( "Logged In Token: " + token );
      if( token ) {

      }
      
      //HTTP.setTotalUsers( totalUsers );

      let result = await incrAsync( "NUM_USERS", 1 );
      console.log( "CURRENT USERS: " + result );

      let packet = {};
      packet.userid = this.id;
      redisClient.publish( "USER_ONLINE", JSON.stringify( packet ) );

      packet = {};
      let self = this;
      
      users[ //this.user.id ] = this;
    } );*/

    /*this.user.on( "POWER_UPDATED", () => {
      console.log( "POWER UPDATED" );
      
      let packet = {};
      packet.userid = //this.user.id;
      packet.username = //this.user.username;
      packet.roundid = //this.user.currentRound;
      packet.power = //this.user.power;
      //redisClient.publish( "SET_POWER", JSON.stringify( packet ) );
    } );*/
    
    /*this.user.on( "MAIL_SENT", function( data ) {
      console.log( "MAIL SENT" );		
      
      //Is the user signed on?  If so, push a message down their connection
      if( users[ data.recipient ] ) {
        users[ data.recipient ].connection.emit( "NEW_MAIL" );
      } else {
        let obj = {};
        obj.userid = data.recipient;
        obj.message = "NEW_MAIL";

        //redisClient.publish( "USER_MESSAGE", JSON.stringify( obj ) );
      }
    } );*/
    
    /*this.user.on( "ITEMS_SENT", function( data ) {
      console.log( "ITEMS SENT - TODO UPDATE USER IF THEY'RE LOGGED IN" );
      console.log( data );			
    } );*/
    
    //this.user.login( username, password, token, this.os );
  /*} );
  
  socket.on( "CLAIM_DAILY", function() {
    //if( this.user ) {
      //this.user.claimDaily();
    //}
  } );
  
  socket.on( "LOGOUT", function( data ) {		
    /*if( this.user ) {
      //this.user.logout();			
    
      delete users[ this.user.id ];
      totalUsers--;
      //HTTP.setTotalUsers( totalUsers );
      this.user = null;
    
      socket.emit( "LOGGED_OUT" );
    }*/
  /*} );
  
  socket.on( "VALIDATE_CLIENT", async function( data ) {
    /*let version = parseInt( Buffer.from( data.version, "base64" ).toString(), 10 );
    let platform = Buffer.from( data.platform, "base64" ).toString();				
    let query = "SELECT minimum_version FROM apps WHERE platform = '" + platform + "' LIMIT 1";			
    
    console.log( "Validating..." );
    const app = await database.getOne( query );
    console.log( "Done Validating" );
    if( app ) {
      if( app.minimum_version <= version ) socket.emit( "VALIDATED" );
      else socket.emit( "ERROR", "Please update the game" );
    } else socket.emit( "ERROR", "Error validating client" );*/
  /*} );
  
  socket.on( "EXPLORE", async function( data ) {
    let energy = parseInt( Buffer.from( data.energy, "base64" ).toString(), 10 );
    
    try {
      //this.user.explore( energy );
    } catch( err ) {
      logger.logError( "Explore(Server): " + err );
    }
  } );
  
  socket.on( "BUILD", function( data ) {
    let quantity = parseInt( Buffer.from( data.quantity, "base64" ).toString(), 10 );
    let type = Buffer.from( data.type, "base64" ).toString();
    
    /*try {
      if( this.user ) this.user.build( type, quantity );		
    } catch( err ) {
      logger.logError( "Build(Server): " + err );
    }*/
  /*} );
  
  socket.on( "GATHER", function( data ) {
    let energy = parseInt( Buffer.from( data.energy, "base64" ).toString(), 10 );
    let type = Buffer.from( data.type, "base64" ).toString();
    
    /*try {
      if( this.user ) //this.user.gather( type, energy );
    } catch( err ) {
      logger.logError( "Gather(Server): " + err );
    }*/
  /*} );
  
  socket.on( "NEWS", async function( data ) {
    const news = await database.get( "SELECT title, body, date FROM news ORDER BY id DESC LIMIT 5" );
    socket.emit( "SERVER_NEWS", news );		
  } );
  
  socket.on( "RULES", async function( data ) {
    const rules = await database.get( "SELECT position, rule FROM rules ORDER BY position" );
    socket.emit( "SERVER_RULES", rules );			
  } );
  
  socket.on( "RECRUIT", function( data ) {
    let quantity = parseInt( Buffer.from( data.quantity, "base64" ).toString(), 10 );
    let type = Buffer.from( data.type, "base64" ).toString();
      
      if( this.user ) //this.user.recruit( type, quantity );
    try {
    } catch( err ) {
      logger.logError( "Recruit(Server): " + err );
    }
  } );
  
  socket.on( "SEND_SHOUT", function( data ) {
    let shout = Buffer.from( data.shout, "base64" ).toString();
    
    //if( this.user ) //this.user.sendShout( shout );				
  } );
  
  socket.on( "CHANGE_PASSWORD", function( data ) {
    if( this.user ) {
      let oldPassword = Buffer.from( data.oldPassword, "base64" ).toString();	
      let newPassword = Buffer.from( data.newPassword, "base64" ).toString();
      
      //this.user.changePassword( oldPassword, newPassword );
    }
  } );
  
  socket.on( "CHANGE_EMAIL", function( data ) {
    if( this.user ) {
      let password = Buffer.from( data.password, "base64" ).toString();	
      let email = Buffer.from( data.email, "base64" ).toString();
      
      //this.user.changeEmail( password, email );
    }
  } );
  
  socket.on( "GET_CONTACTS", function( data ) {
    if( this.user ) {
      //this.user.getContacts();
    }
  } );
  
  socket.on( "GET_MARKET_ITEM_INFO", function( data ) {
    if( this.user ) {
      let item = Buffer.from( data.item, "base64" ).toString();		
      //this.user.getMarketItemInfo( item );
    }
  } );
  
  socket.on( "GET_SHOUTS", async function( data ) {		
    /*if( this.user ) {
      const shouts = await database.get( "SELECT username, avatar, time, shout FROM shoutbox INNER JOIN users ON userid = users.id WHERE shoutbox.userid NOT IN ( SELECT contactid AS userid FROM contacts WHERE userid = " + //this.user.id + " AND type='blocked' ) ORDER BY shoutbox.id DESC LIMIT 20" );
      //socket.emit( "GET_SHOUTS", shouts );			
    }*/
  /*} );
  
  socket.on( "SET_AVATAR", function( data ) {
    if( this.user ) {
      let avatar = parseInt( Buffer.from( data.avatar, "base64" ).toString(), 10 );
      
      //this.user.setAvatar( avatar );
    }
  } );
  
  socket.on( "GET_AVATARS", function() {
    if( this.user ) {
      //this.user.getAvatars();
    }
  } );
  
  socket.on( "GET_TARGETS", function() {
    if( this.user ) {
      //this.user.getTargets();
    }
  } );
  
  socket.on( "GET_FIGHTS", function( data ) {
    if( this.user ) {
      let page = parseInt( Buffer.from( data.page, "base64" ).toString(), 10 );
      let per = parseInt( Buffer.from( data.per, "base64" ).toString(), 10 );
      
      //this.user.getFights( page, per );
    }
  } );
  
  socket.on( "GET_FIGHT", function( data ) {
    if( this.user ) {
      let guid = Buffer.from( data.fight, "base64" ).toString();
      //this.user.getFight( guid );
    }
  } );
  
  socket.on( "DELETE_FIGHT", function( data ) {
    if ( this.user ) {
      let guid = Buffer.from( data.fight, "base64" ).toString();
      //this.user.deleteFight( guid );
    }
  } );
  
  socket.on( "ATTACK", function( data ) {
    if( this.user ) {
      let target = Buffer.from( data.target, "base64" ).toString();
      //this.user.attack( target )
    }
  } );
  
  socket.on( "RAID", function( data ) {
    if( this.user ) {
      let target = Buffer.from( data.target, "base64" ).toString();
      //this.user.raid( target );
    }
  } );
  
  socket.on( "GET_JOBS", function() {
    if( this.user ) {
      ////this.user.getJobs();

      let packet = {};
      packet.userid = //this.user.id;
      redisClient.publish( "GET_JOBS", JSON.stringify( packet ) );

      /*let packet = {};
      packet.userid = //this.user.id;
      packet.job = "88305e48-8987-4b46-b2e2-c15e7cf38ada";
      redisClient.publish( "CLAIM_JOB", JSON.stringify( packet ) );*/
    /*}
  } );
  
  socket.on( "CLAIM_JOB", function( data ) {
    if( this.user ) {
      let job = Buffer.from( data.job, "base64" ).toString();
      ////this.user.claimJob( job );

      let packet = {};
      packet.userid = //this.user.id;
      packet.job = job;
      redisClient.publish( "CLAIM_JOB", JSON.stringify( packet ) );
    }
  } );
  
  socket.on( "JOIN_SHOUT", function( data ) {
    if( this.user ) {
      logger.logError( "JOIN_SHOUT NYI" );
    }		
  } );
  
  socket.on( "LEAVE_SHOUT", function( data ) {
    if( this.user ) {
      logger.logError( "LEAVE_SHOUT NYI" );
    }
  } );
  
  socket.on( "ADD_FRIEND", function( data ) {
    if( this.user ) {
      let name = Buffer.from( data.name, "base64" ).toString();
      
      //this.user.addFriend( name );
    }
  } );
  
  socket.on( "REMOVE_FRIEND", function( data ) {
    if( this.user ) {
      let name = Buffer.from( data.name, "base64" ).toString();
      
      //this.user.removeFriend( name );
    }
  } );
  
  socket.on( "GET_FRIENDS", function() {
    if( this.user ) {
      //this.user.getFriends();
    }
  } );
  
  socket.on( "ADD_ENEMY", function( data ) {
    if( this.user ) {
      let name = Buffer.from( data.name, "base64" ).toString();
      
      //this.user.addEnemy( name );
    }
  } );
  
  socket.on( "REMOVE_ENEMY", function( data ) {
    if( this.user ) {
      let name = Buffer.from( data.name, "base64" ).toString();
      
      //this.user.removeEnemy( name );
    }
  } );
  
  socket.on( "GET_ENEMIES", function() {
    if( this.user ) {
      //this.user.getEnemies();
    }
  } );
  
  socket.on( "ADD_BLOCKED", function( data ) {
    if( this.user ) {
      let name = Buffer.from( data.name, "base64" ).toString();
      
      //this.user.addBlocked( name );
    }
  } );
  
  socket.on( "REMOVE_BLOCKED", function( data ) {
    if( this.user ) {
      let name = Buffer.from( data.name, "base64" ).toString();			
      //this.user.removeBlocked( name );
    }
  } );
  
  socket.on( "GET_SUMMARY", function() {
    if( this.user ) {
      //this.user.getSummary();
    }
  } );
  
  socket.on( "SUBMIT_CONTACT", function( data ) {		
    if( this.user ) {
      let message = Buffer.from( data.message, "base64" ).toString();
      //this.user.submitContact( message );
    }					
  } );
  
  socket.on( "GET_BLOCKED", function() {
    if( this.user ) {
      //this.user.getBlocked();
    }
  } );
  
  socket.on( "GET_NEARBY_RANKINGS", function() {
    /*if( this.user ) {
      this.user.getNearbyRankings();
      
      let packet = {};      
      packet.username = //this.user.username;
      packet.roundid = //this.user.currentRound;
      packet.server = guid;
      packet.request = UUID();
      redisClient.publish( "GET_RANKINGS", JSON.stringify( packet ) );

      rankRequests[ packet.request ] = //this.user.id;
    }*/
  /*} );
  
  socket.on( "GET_TOP_RANKINGS", function() {
    if( this.user ) {
      //this.user.getTopRankings();
    }
  } );
  
  socket.on( "REGISTER_TOKEN", async function( data ) {
    const token = Buffer.from( data.token, "base64" ).toString();
    const os = Buffer.from( data.os, "base64" ).toString();

    socket.token = token;
    socket.os = os;
    
    logger.logServer( "Token: " + socket.token );
    logger.logServer( "OS: " + socket.os );

    if( os === "ios" ) {
      socket.token = socket.token.substring( 1, socket.token.length - 1 );
      socket.token = socket.token.replace( / /g,'' );
      logger.logServer( "Token: " + socket.token );
    }

    socket.emit( "TOKEN_REGISTERED" );
  } );
  
  socket.on( "SEARCH_USERS", async function( data ) {
    /*if( this.user ) {
      let search = Buffer.from( data.search, "base64" ).toString();								
      let query = "SELECT username, avatar FROM users WHERE username LIKE '%" + search + "%' ORDER BY ( CASE WHEN username = '" + search + "' then 1 ELSE 0 END) + ( CASE WHEN username LIKE '" + search + "%' THEN 1 ELSE 0 END ) + ( CASE WHEN username LIKE '%" + search + "%' THEN 1 ELSE 0 END ) DESC;"
      
      const users = await database.get( "SELECT username, avatar, time, shout FROM shoutbox INNER JOIN users ON userid = users.id WHERE shoutbox.userid NOT IN ( SELECT contactid AS userid FROM contacts WHERE userid = " + //this.user.id + " AND type='blocked' ) ORDER BY shoutbox.id DESC LIMIT 20" );
      if( users ) socket.emit( "USERS_SEARCH_SUCCESS", users );
      else {
        logger.logError( "Query: " + query );
        socket.emit( "USER_ERROR", "Error Searching" );
      }			
    }*/
  /*} );
  
  socket.on( "GET_USER", function( data ) {
    if( this.user ) {
      let username = validator.escape( Buffer.from( data.name, "base64" ).toString() );
      
      //this.user.lookUpUser( username );
    }
  } );
    
  socket.on( "GET_EVENTS", function( data ) {
    if( this.user ) {
      let page = parseInt( Buffer.from( data.page, "base64" ).toString(), 10 );
      let per = parseInt( Buffer.from( data.per, "base64" ).toString(), 10 );
    
      //this.user.getEvents( page, per );
    }
  } );
  
  socket.on( "DELETE_EVENT", function( data ) {
    if( this.user ) {
      let id = parseInt( Buffer.from( data.id, "base64").toString(), 10 );
      
      //this.user.deleteEvent( id );
    }
  } );
  
  socket.on( "DELETE_ALL_EVENTS", function() {
    if( this.user ) {
      //this.user.deleteAllEvents();
    }
  } );
  
  socket.on( "SEND_MAIL", function( data ) {
    if( this.user ) {
      let recipient = Buffer.from( data.username, "base64" ).toString();
      let message = data.message;
      
      //this.user.sendMail( recipient, message );
    }
  } );
  
  socket.on( "GET_MAILS", function( data ) {
    if( this.user ) {			
      let page = parseInt( Buffer.from( data.page != null ? data.page : 1, "base64" ).toString(), 10 );
      let per = parseInt( Buffer.from( data.per != null ? data.per : 15, "base64" ).toString(), 10 );
      
      //this.user.getMails( page, per );
    }
  } );
  
  socket.on( "GET_MAIL_DETAILS", function( data ) {
    if( this.user ) {
      let page = parseInt( Buffer.from( data.page, "base64" ).toString(), 10 );
      let username = Buffer.from( data.username, "base64" ).toString();
      
      //this.user.getConversation( username, page );
    }
  } );
  
  socket.on( "DELETE_MAIL", function( data ) {
    if( this.user ) {
      let name = Buffer.from( data.name, "base64").toString();
      
      //this.user.deleteMail( name );
    }
  } );	
  
  socket.on( "DELETE_ALL_MAILS", function() {
    if( this.user ) {
      //this.user.deleteMails();
    }
  } );
  
  socket.on( "MARK_ALL_MAILS", function() {
    if( this.user ) {
      //this.user.markAllMail();
    }
  } );
  
  socket.on( "START_RESEARCH", function( data ) {
    if( this.user ) {
      let id = parseInt( Buffer.from( data.id, "base64").toString(), 10 );
      
      //this.user.startResearch( id );
    }
  } );
  
  socket.on( "REGISTER_USER", async function( data ) {
    logger.logUser( "Registering" );
    
    const username = validator.trim( validator.escape( Buffer.from( data.username, "base64" ).toString() ) );
    const password = validator.trim( validator.escape( Buffer.from( data.password, "base64" ).toString() ) );
    const email = validator.trim( validator.escape( Buffer.from( data.email, "base64" ).toString() ) );
    
    if( !validator.isAlphanumeric( username ) ) {
      logger.logError( "Register: username = " + username );
      socket.emit( "ERROR", "Username can only contain letters and numbers" );
      return;
    }
    if( !validator.isEmail( email ) ) {
      logger.logError( "Register: email = " + email );
      socket.emit( "ERROR", "Invalid e-mail address" );
      return;
    }		
    
    const check = await database.getOne( "SELECT id, username, email FROM users WHERE username = '" + username + "' OR email = '" + email + "'" );
    if( check ) {
      let error = check.username == username ? "Username is already in use" : "Email is already in use";
      socket.emit( "ERROR", error );
    } else {
      const salt = await bcrypt.genSalt( 5 );
      const hashedPassword = await bcrypt.hash( password, salt );
      const userQuery = "INSERT INTO users SET sex='m', username = '" + username + "', password = '" + hashedPassword + "', email = '" + email + "', avatar = 'male1', created = UNIX_TIMESTAMP(), current_round = 0";

      const result = await database.execute( userQuery );			
      if( result && result.affectedRows == 1 ) {
        // Setup default notification settings				
        const notifications = [ 'mail', 'attack', 'energy' ];
        notifications.forEach( async( type ) => { 
          const notificationQuery = "INSERT INTO users_notifications_settings SET userid = " + result.insertId + ", type = '" + type + "'";
          console.log( "Query: " + notificationQuery );
          const res = await database.execute( notificationQuery );
          if( !res || res.affectedRows !== 1 ) {
            logger.logError( "Error Setting Up Notification Settings: " + notificationQuery );
          }
        } );

        socket.emit( "USER_REGISTERED", {} );
      } else socket.emit( "ERROR", "Error creating account" );
    }		
  } );
  
  socket.on( "RECOVER_PASSWORD", async function( data ) {
    let email = validator.escape( Buffer.from( data.email, "base64" ).toString() );
    
    const result = await database.getOne( "SELECT id FROM users WHERE email = '" + email + "' LIMIT 1" );
    if( result ) {				
      socket.emit( "PASSWORD_SENT" );
    } else {
      logger.logError( "Error recovering password: " + email );
      socket.emit( "PASSWORD_SENT" );
    }
  } );
  
  socket.on( "SEND_ITEMS", function( data ) {
    if( this.user ) {
      let to = Buffer.from( data.to, "base64").toString();
      let category = Buffer.from( data.category, "base64").toString();
      let type = Buffer.from( data.type, "base64").toString();
      let quantity = parseInt( Buffer.from( data.quantity, "base64").toString(), 10 );
      
      //this.user.sendItem( to, category, type, quantity );
    }
  } );
  
  socket.on( "GET_ROUNDS", function() {
    if( this.user ) {
      //this.user.getRounds();
    }
  } );

  socket.on( "GET_FINISHED_ROUNDS", function( data ) {
    if( this.user ) {
      const page = parseInt( Buffer.from( data.page, "base64" ).toString(), 10 );
      //this.user.getFinishedRounds( page );
    }
  } );
  
  socket.on( "JOIN_ROUND", function( data ) {
    if( this.user ) {
      let round = parseInt( Buffer.from( data.round, "base64").toString(), 10 );
      //this.user.joinRound( round );
    }
  } );
  
  socket.on( "PLAY_ROUND", function( data ) {
    if( this.user ) {			
      let round = parseInt( Buffer.from( data.round, "base64").toString(), 10 );
      //this.user.playRound( round );
    }
  } );
  
  socket.on( "STOP_RESEARCH", function( data ) {
    if( this.user ) {
      let id = parseInt( Buffer.from( data.id, "base64").toString(), 10 );
      
      //this.user.stopResearch( id );
    }
  } );
  
  socket.on( "BUY_energy", function( data ) {
    //if( this.user ) {
      //this.user.buyenergy();
    //}
  } );
  
  socket.on( "GET_ITEMS", function() {
    //if( this.user ) {
      //this.user.getItems();
    //}
  } );
  
  socket.on( "USE_ITEM", function( data ) {
    /*if( this.user ) {
      let item = parseInt( Buffer.from( data.item, "base64" ).toString(), 10 );
      
      //this.user.useItem( item );
    }*/
  /*} );
  
  socket.on( "MARKET_BUY", function( data ) {
    /*if( this.user ) {
      let type = Buffer.from( data.type, "base64" ).toString();
      let item = Buffer.from( data.item, "base64" ).toString();
      let quantity = parseInt( Buffer.from( data.quantity, "base64" ).toString(), 10 );
      let price = parseFloat( Buffer.from( data.price, "base64" ).toString(), 10 );
      
      //this.user.buyMarket( type, item, quantity, price );
    }*/
  /*} );

  socket.on( "MARKET_SELL", function( data ) {
    /*if( this.user ) {
      let type = Buffer.from( data.type, "base64" ).toString();
      let item = Buffer.from( data.item, "base64" ).toString();
      let quantity = parseInt( Buffer.from( data.quantity, "base64" ).toString(), 10 );
      let price = parseFloat( Buffer.from( data.price, "base64" ).toString(), 10 );
      
      //this.user.sellMarket( type, item, quantity, price );
    }*/
  /*} );
  
  socket.on( "MARKET_INFO", function( data ) {
    //if( this.user ) {
      //this.user.getMarketInfo();
    //}
  } );
  
  socket.on( "DESTROY_BUILDINGS", function( data ) {
    /*if( this.user ) {
      let type = Buffer.from( data.type, "base64" ).toString();			
      let quantity = parseInt( Buffer.from( data.quantity, "base64" ).toString(), 10 );
      
      //this.user.destroyBuildings( type, quantity );
    }*/
  /*} );
  
  socket.on( "FIRE_UNITS", function( data ) {
    /*if( this.user ) {
      let type = Buffer.from( data.type, "base64" ).toString();			
      let quantity = parseInt( Buffer.from( data.quantity, "base64" ).toString(), 10 );
      
      //this.user.fireUnits( type, quantity );
    }*/
  /*} );
  
  socket.on( "MARKET_POST", function( data ) {
    /*if( this.user ) {			
      let type = Buffer.from( data.type, "base64" ).toString();
      let item = Buffer.from( data.item, "base64" ).toString();
      let quantity = parseInt( Buffer.from( data.quantity, "base64" ).toString(), 10 );
      let price = parseInt( Buffer.from( data.price, "base64" ).toString(), 10 );
      
      //this.user.postAuction( type, item, quantity, price );
    }*/
  /*} );

  socket.on( "GET_NOTIFICATION_SETTINGS", function() {
    //if( this.user ) {
      //this.user.getNotificationSettings();
    //}
  } );

  socket.on( "UPDATE_NOTIFICATION_SETTING", function( data ) {
    /*if( this.user ) {
      const type = Buffer.from( data.type, "base64" ).toString();
      const value = parseInt( Buffer.from( data.value, "base64" ).toString(), 10 );
      
      //this.user.setNotificationSetting( type, value );
    }*/
  /*} );
  
  socket.on( "GET_BUILDING_DATA", async function( data ) {
    const buildings = await database.get( "SELECT * FROM buildings WHERE available = 1 ORDER BY display_position, name" );
    socket.emit( "BUILDING_DATA", buildings );		
  } );
  
  socket.on( "GET_UNIT_DATA", async function( data ) {
    const units = await database.get( "SELECT * FROM units WHERE available = 1 ORDER BY display_position, name" );
    socket.emit( "UNIT_DATA", units );		
  } );
  
  socket.on( "GET_RESOURCE_DATA", async function( data ) {
    const resources = await database.get( "SELECT * FROM resources WHERE available = 1 ORDER BY display_position, name" );
    socket.emit( "RESOURCE_DATA", resources );		
  } );
  
  socket.on( "GET_ITEM_DATA", async function( data ) {
    console.log( "Received GET_ITEM_DATA" );
    const items = await database.get( "SELECT * FROM items WHERE available = 1" );
    console.log( "EMITTING ITEM_DATA" );
    socket.emit( "ITEM_DATA", items );
  } );
  
  socket.on( 'disconnect', function() {
    logger.logConnection( socket.handshake.headers[ 'x-real-ip' ] + ' disconnected' );
    
    /*if( this.user ) {
      //this.user.saveSnapshot();
            
      delete users[ //this.user.id ];
      totalUsers--;
      //HTTP.setTotalUsers( totalUsers );
      redisClient.decr( "NUM_USERS", () => {
        redisClient.get( "NUM_USERS", ( err, res ) => { logger.logServer( "CURRENT USERS: " + res ); } );
      } );

      let packet = {};
      packet.userid = //this.user.id;
      redisClient.publish( "USER_OFFLINE", JSON.stringify( packet ) );

      logger.logServer( "Current Users: " + totalUsers );
    }*/
  //} );
//} );

console.log( "Server Started: " + guid );

//==========================================//
//	Crons									                  //
//==========================================//
new CronManager( users, dbase );