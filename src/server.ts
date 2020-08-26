//==================================//
//	Requires						//
//==================================//
const { promisify } = require( 'util' );
let UUID = require( 'uuid/v4' );
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
  redisListener.subscribe( "USER_ONLINE" );
  redisListener.subscribe( "JOB_READY" );
  redisListener.subscribe( "JOBS_RETRIEVED" );
  redisListener.subscribe( "JOBS_CLEARED" );
  redisListener.subscribe( "JOB_CLAIMED" );
  redisListener.subscribe( "JOB_ERROR" );
  redisListener.subscribe( "SHOUT_SENT" );
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
        case "USER_BANNED": {
            const { userid } = data;
            if( users[ userid ] ) {                 
                users[ userid ].connection.close( "1", "BANNED" );
            }  
        } break;
        case "CHAT_MESSAGE": {
            console.log( data );
            const { user:userid, packet } = data;
            if( users[ userid ] ) {
                console.log( userid );
                console.log( packet );
                users[ userid ].connection.sendUTF( JSON.stringify( packet ) );
            } else console.log( "NO CONNECTION" );
        } break;
        default: console.log( "UNKNOWN COMMAND: " + data.command ); break;
      }
      break;
    case "USER_MESSAGE":
      if( users[ data.userid ] ) {
        users[ data.userid ].connection.emit( data.message );
      }
      break;
    case "USER_ONLINE": {
      // Make sure we're not getting our own message
      if( data.server !== guid ) {
        if( users[ data.userid ] ) {
          console.log( "CLOSING CONNECTION" );
          users[ data.userid ].connection.close( "1", "OTHER_SIGN_ON" );
        }
      }
    } break;
    case "SHOUT_SENT": {
      _conversationsController.processShout( data );
    } break;
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
const _conversationsController:ChatsController = new ChatsController( redisClient );
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

    /*units.forEach( async( unit ) => {
        await dbase.query( 'INSERT INTO users_rounds_units ( userid, roundid, unitid, quantity ) VALUES ( ?, 45, ?, ? )', [ unit.u, unit.unit, unit.quantity ] );
    } );*/

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
    /*buildings.forEach( async( building ) => {
        await dbase.query( 'INSERT INTO users_rounds_buildings ( userid, roundid, buildingid, quantity ) VALUES ( 3, 45, ?, ? )', [ building.building, building.quantity ] );
    } );*/

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
//test();

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

let connectionID:number = 1;

server.on( 'connect', ( connection:WebSocket.connection ) => {
    let user:User|null;
    let userid:number = -1;
    let token:string = '';
    let deviceID:string = "";
    let os:string = '';
    let id:number = connectionID++;
    
    if( connectionID > 10000000 ) connectionID = 1;

    console.log( "WE HAVE CONNECTION" );    
    console.log( connection.remoteAddress );    

    connection.on( 'message', async payload => {
        //console.log( 'RECEIVED MESSAGE' );
        let data = JSON.parse( payload.utf8Data as string );
        //console.log( data );

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
                    connection,
                    id
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

                let result:RowDataPacket = await dbase.getOne( `SELECT COUNT(id) AS total FROM users_push_tokens WHERE token = ? AND userid <> ?`, [ token, tempUser.id ] );
                if( result && result.total >= 2 ) return send( { type:'ERROR', data:{ code: 'login-too-many' } } );  
                
                if( tempUser.banned ) {
                    const date:Date = new Date();
                    const ticks:number = Math.floor( new Date().getTime() / 1000 );
                    
                    send( { type:"LOGIN_BANNED", data: { reason: tempUser.bannedReason, until: ( tempUser.bannedUntil - ticks ) } } );
                    return;
                }

                user = tempUser;
                user.redis = redisClient;
                user.connection = connection;
                user.token = token;
                user.recordIP( connection.remoteAddress );
                _userController.recordPushToken( user, token, os );
                _userController.recordDevice( user, deviceID, os );

                user.updateLastLogin();
                user.updateLastSeen();

                let check:boolean = await user.checkForDupes();
                if( check ) {
                    console.log( 'LOGGED IN' );
                    send( { type:'LOGIN_SUCCESS', data:user.trim() } );
                } else console.log( 'what da shit' );

                // See if we're online already
                if( users[ user.id ] ) {
                  console.log( "CLOSING CONNECTION" );
                  users[ user.id ].connection.close( "1", "OTHER_SIGN_ON" );
                  users[ user.id ]
                } else console.log( "NO CURRENT CONNECTION" );

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

                console.log( "SENDING USER_ONLINE" );
                redisClient.publish( "USER_ONLINE", JSON.stringify( packet ) );
            } break;
            case 'validate_device': {
                token = data.token;
                deviceID = data.device;
                os = data.os;                

                console.log( 'TOKEN: ' + token + '(' + os + ')' );

                const version:number = parseInt( data.version.replace( /\./g, '' ) );
                const result:RowDataPacket = await dbase.getOne( 'SELECT minimum_version FROM apps WHERE platform = ?', [ os ] );
                const min:number = parseInt( result.minimum_version.replace( /\./g, '' ) );

                if( version < min ) send( { type:'UPGRADE_REQUIRED' } );
                else send( { type:'VALIDATED' } );
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
                    case 'get_active_rounds':
                    case 'get_finished_rounds':
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
                    case 'get_settings':
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
                    case "claim_job":
                    case 'get_jobs': {
                        const message:JSONObject|null = await _jobsController.process( data, user, guid, connection );
                        console.log( message );
                        if( message !== null ) send( message );
                    } break;
                    case 'contact':
                    case 'get_shouts':
                    case 'send_shout':
                    case 'join_shoutbox':
                    case 'leave_shoutbox':
                    case 'get_conversation':
                    case 'get_conversations':
                    case 'mark_all_read':
                    case 'delete_chats':                        
                    case 'delete_chat':
                    case 'send_message': {
                        send( await _conversationsController.process( data, user, connection, redisClient, getAsync ) );
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
                        console.log( data );
                        console.log( chalk.white.bgRed( 'ERROR:' ) + chalk.red( ' Unhandled Command - ' + data.command ) );
                        break;
                }
            }
        }
    } );

    connection.on( 'close', async ( reason, description ) => {
        if( user ) {
            user.stop();

            if( users[ user.id ] ) {
              if( users[ user.id ].id == id )
                delete users[ user.id ];
            }

            let packet:JSONObject = {};
            packet.server = guid;
            packet.userid = user.id;
            
            redisClient.publish( "USER_OFFLINE", JSON.stringify( packet ) );

            await delAsync( 'USER-' + user.id );
            await decrAsync( 'USERS-ONLINE', 1 );
            const online:number = await getAsync( 'USERS-ONLINE' );
            console.log( 'Online Users: ' + online );
            totalUsers--;
        }
    } );

    try {
        if( process.env.MAINTENANCE && parseInt( process.env.MAINTENANCE ) === 1 ) connection.sendUTF( JSON.stringify( { type: 'MAINTENANCE' } ) );
        else connection.sendUTF( JSON.stringify( { type: 'PING' } ) );
    } catch( err ) {
        console.log( chalk.red( 'CONNECTION ERROR' ) );
        console.log( err );
    }
} );

server.on( 'close', connection => {    
    console.log( "WE LOST CONNECTION" );
    //process.exit( 1 );
} );

console.log( "Server Started: " + guid );

//==========================//
//	Crons                   //
//==========================//
new CronManager( users, dbase );