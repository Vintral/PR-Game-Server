//==================================//
//	Requires						//
//==================================//
const { promisify } = require( 'util' );
let UUID = require( 'uuid/v4' );
import chalk from 'chalk';
import { RowDataPacket } from 'mysql2/promise';
import dbase from './database';

import dotenv from 'dotenv';
dotenv.config();

import logger from './logger';

import { JSONObject } from './interfaces';

const messages:Array<String> = [
    "Yo",
    "S'up",
    "DEATH TO YOU",
    "THIS MEANS WAR",
    "You will rue the day!",
    "Plz leave me alone",
    "You'll regret this",
    "I'll kick your ass!",
    "You'll see",
    "ha",
    "noob",
    "dude, you suck at this"
]
let users:Array<number> = [];

async function getConversation( user1, user2 ):Promise<number> {
    let result:RowDataPacket = await dbase.getOne( `SELECT * FROM conversations WHERE ( user1 = ? AND user2 = ? ) OR ( user1 = ? AND user2 = ?)`, [ user1, user2, user2, user1 ] );    

    if( !result ) {
        result = await dbase.query( `INSERT INTO conversations ( user1, user2 ) VALUES ( ?, ? )`, [ user1, user2 ] );
        return result[ 0 ].insertId;
    } return result.id;
}

async function fill() {
    
}

async function load() {
    let data:RowDataPacket = await dbase.get( `SELECT id FROM users WHERE id > 1` );    
    for( let i = 0; i < data.length; i++ ) {
        users.push( data[ i ].id );
    }
}

function pickUser( notUser ) {
    let index:number = Math.floor( Math.random() * users.length );
    if( users[ index ] === notUser ) return pickUser( notUser );
    return users[ index ];
}

function pickMessage() {
    let index:number = Math.floor( Math.random() * messages.length );
    return messages[ index ];
}

async function insertMessage() {
    let user1:number = pickUser( 0 );
    let user2:number = pickUser( user1 );
    let message:String = pickMessage();
    let conversation:number = await getConversation( user1, user2 );

    const queries:JSONObject = {
        insert: `INSERT INTO messages ( conversation, sender, message, sent, sender_view, recipient_view ) VALUES ( ?, ?, ?, UNIX_TIMESTAMP(), 1, 1)`,
        update1: `UPDATE conversations_users SET sender = ?, message = ?, sent = UNIX_TIMESTAMP() WHERE conversation = ? AND userid = ?`,
        update2: `UPDATE conversations_users SET sender = ?, message = ?, sent = UNIX_TIMESTAMP() WHERE conversation = ? AND userid <> ?`,
        create: `INSERT INTO conversations_users ( conversation, userid, sender, message, sent ) VALUES ( ?, ?, ?, ?, UNIX_TIMESTAMP() )`
    }

    let result:RowDataPacket = await dbase.query( queries.insert, [ conversation, user1, message ] );
    result = await dbase.query( queries.update1, [ user1, message, conversation, user1 ] );
    if( result[ 0 ].affectedRows === 1 ) result = await dbase.query( queries.update2, [ user1, message, conversation, user1 ] );
    else {
        result = await dbase.query( queries.create, [ conversation, user1, user1, message ] );
        result = await dbase.query( queries.create, [ conversation, user2, user1, message ] );
    }
}

async function run() {
    await load();
 
    let user1:number;
    let user2:number;
    let message:String;
    let conversation:number;
    let result:RowDataPacket;

    for( let i:number = 0; i < 1000000; i++ ) {
        console.log( "Insert Message: " + ( i + 1 ) );
        
        /*user1 = pickUser( 0 );
        user2 = pickUser( user1 );
        message = pickMessage();
        conversation = await getConversation( user1, user2 );

        result = await dbase.query( `INSERT INTO messages ( conversation, sender, message, sent, sender_view, recipient_view ) VALUES ( ?, ?, ?, UNIX_TIMESTAMP(), 1, 1)`, [ conversation, user1, message ] );
        //result = await dbase.query( `SELECT * FROM users WHERE id = ?`, [ user1 ] );*/

        await insertMessage();
    }
}
run();
