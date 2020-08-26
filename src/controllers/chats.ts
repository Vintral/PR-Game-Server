import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import * as WebSocket from 'websocket';
import { JSONObject } from '../interfaces';
import { User } from '../models';
import { Base64 } from 'js-base64';

export default class ChatsController {
    private _debug:boolean = true;
    private _redis:any = '';    
    private _connections:Array<WebSocket.connection> = [];

    constructor( redisClient:any ) { 
        this._redis = redisClient;    
    }

    public async process( data:JSONObject, user:User, connection:WebSocket.connection, redis:any, getter:any  ):Promise<JSONObject> {        
        try {            
            switch( data.command ) {
                case 'get_conversations': return { type:'CONVERSATIONS', data: await this.getConversations( user, data ) };
                case 'get_conversation': return { type:'CONVERSATION', data: await this.getConversation( user, data ) };
                case 'get_shouts': return { type:'SHOUTS', data: await this.getShouts( user ) };
                case 'send_shout': return await this.sendShout( user, data );
                case 'join_shoutbox': return { type:'SHOUTBOX_JOINED', data: await this.joinShoutbox( user, connection ) };
                case 'leave_shoutbox': return { type:'SHOUTBOX_LEFT', data: await this.leaveShoutbox( user, connection  ) };
                case 'send_message': return await this.sendMessage( user, data, connection, redis, getter );
                case 'mark_all_read': return await this.markAllRead( user );
                case 'delete_chats': return await this.deleteChats( user );                
                case 'delete_chat': return await this.deleteChat( user, data );
                case 'contact': return { type:'CONTACT_SUBMITTED', data: await this.submitContact( user, data ) };
            }
        } catch( err ) {
            console.log( 'ERROR: ' + err );
        }

        return { type:'ERROR', data:'Conversations Error' };
    }

    public async processShout( data:JSONObject ):Promise<void> {
        this.debug( "processShout" );
        this._connections.forEach( connection => connection.sendUTF( JSON.stringify( { type:"SHOUT", data } ) ) );
    }

    private async submitContact( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'submitContact' );

        const query:string = `INSERT INTO contact_submissions ( userid, roundid, message, time, viewed ) VALUES ( ?, ?, ?, UNIX_TIMESTAMP(), 0 )`;
        const result:RowDataPacket = await dbase.query( query, [ user.id, user.round, data.message ] );

        return {};
    }

    private async sendShout( user:User, payload:JSONObject ):Promise<JSONObject> {
        this.debug( 'sendShout' );
        console.log( payload );

        let shout:string = Base64.decode( payload.shout );

        const queries:JSONObject = {
            banned: `SELECT banned_shoutbox FROM users WHERE id = ?`,
            insert: `INSERT INTO shoutbox ( userid, shout, time, deleted ) VALUES ( ? , ? , UNIX_TIMESTAMP(), ?)`,
            retrieve: `SELECT time FROM shoutbox WHERE id = ?`
        }

        let result:RowDataPacket = await dbase.getOne( queries.banned, [ user.id ] );
        console.log( result );
        let banned:boolean = result.banned_shoutbox === 1;

        result = await dbase.query( queries.insert, [ user.id, shout, banned ? 1 : 0 ] );
        console.log( result );

        let inserted:RowDataPacket = await dbase.getOne( queries.retrieve, [ result[ 0 ].insertId ] );

        const data:JSONObject = {};
        data.avatar = user.avatar;
        data.time = inserted.time;
        data.username = user.username;        
        data.shout = Base64.encode( shout );

        if( !banned ) this._redis.publish( 'SHOUT_SENT', JSON.stringify( data ) );
        else this._connections[ user.id ].sendUTF( JSON.stringify( { type:"SHOUT", data } ) );        

        return { type:'SHOUT_SENT' };
    }

    private async markAllRead( user:User ):Promise<JSONObject> {
        this.debug( "markAllRead" );

        const query:string = `UPDATE messages INNER JOIN conversations on conversations.id = conversation SET seen = 1 WHERE ( user1 = ? OR user2 = ? ) AND sender <> ?`;
        let result:RowDataPacket = await dbase.query( query, [ user.id, user.id, user.id ] );

        return { type:"CONVERSATIONS_MARKED_READ" };
    }

    private async deleteChats( user:User ):Promise<JSONObject> {
        this.debug( "deleteChats" );

        const queries:JSONObject = {
            recipient: `UPDATE messages INNER JOIN conversations ON conversations.id = conversation SET recipient_view = 0  WHERE ( user1 = ? OR user2 = ? ) AND sender <> ?`,
            sender: `UPDATE messages INNER JOIN conversations ON conversations.id = conversation SET sender_view = 0  WHERE ( user1 = ? OR user2 = ? ) AND sender = ?`
        }

        let result:RowDataPacket = await dbase.query( queries.recipient, [ user.id, user.id, user.id ] );
        result = await dbase.query( queries.sender, [ user.id, user.id, user.id ] );

        return { type:'CHATS_DELETED' };
    }

    private async deleteChat( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( "deleteChat" );

        const { chat } = data;

        const queries:JSONObject = {
            recipient: `UPDATE messages SET recipient_view = 0  WHERE conversation = ? AND sender <> ?`,
            sender: `UPDATE messages SET sender_view = 0  WHERE conversation = ? AND sender = ?`
        }

        let result:RowDataPacket = await dbase.query( queries.recipient, [ chat, user.id ] );
        result = await dbase.query( queries.sender, [ chat, user.id ] );

        return { type:'CHAT_DELETED', data:{ chat } };
    }
    
    private async sendMessage( user:User, data:JSONObject, connection:WebSocket.connection, redis:any, getter:any ):Promise<JSONObject> {
        this.debug( 'sendMessage' );

        let { to, message } = data;
        let conversation:number = data.conversation;

        message = Base64.decode( message );

        const queries:JSONObject = {
            receiver: `SELECT id FROM users WHERE username = ?`,
            exists: `SELECT id FROM conversations WHERE ( user1 = ? AND user2 = ?) OR ( user1 = ? AND user2 = ? )`,
            create: `INSERT INTO conversations ( user1, user2 ) VALUES ( ?, ? )`,
            retrieve: `SELECT user1, user2 FROM conversations WHERE id = ?`,
            blocked: `SELECT id FROM contacts WHERE contactid = ? AND userid = ? AND type = 'blocked'`,
            insert: `INSERT INTO messages ( conversation, sender, message, sent, sender_view, recipient_view ) VALUES ( ?, ?, ?, UNIX_TIMESTAMP(), ?, ? )`,
            updateCache: `UPDATE conversations_users SET sender = ?, message = ?, sent = UNIX_TIMESTAMP() WHERE conversation = ? AND userid = ?`,
            createCache: `INSERT INTO conversations_users ( conversation, userid, sender, message, sent ) VALUES ( ?, ?, ?, ?, UNIX_TIMESTAMP() )`
        };

        let result:RowDataPacket = await dbase.getOne( queries.receiver, [ to ] );
        if( !result ) throw new Error( 'Recipient not found' );
        const receiverID:number = +result.id;

        if( conversation === 0 ) {            
            result = await dbase.getOne( queries.exists, [ user.id, receiverID, receiverID, user.id ] );

            let conversation:number = -1;
            if( !result ) {
                result = await dbase.query( queries.create, [ user.id, receiverID ] );
                console.log( result );
                conversation = result[ 0 ].insertId;
            } else conversation = result.id;
        }

        result = await dbase.getOne( queries.blocked, [ user.id, receiverID ] );
        const blocked:boolean = result !== undefined;

        result = await dbase.query( queries.insert, [ conversation, user.id, message, 1, blocked ? 0 : 1 ] );

        result = await dbase.query( queries.updateCache, [ user.id, message, conversation, user.id ] );
        if( result[ 0 ].affecteRows === 1 ) {
            if( !blocked ) await dbase.query( queries.updateCache, [ user.id, message, conversation, receiverID ] );
        } else {
            result = await dbase.query( queries.createCache, [ conversation, user.id, user.id, message ] );
            if( !blocked ) result = await dbase.query( queries.createCache, [ conversation, receiverID, user.id, message ] );
        }

        let packet:JSONObject = {
            type: "CHAT_MESSAGE",
            data: {
                chat: conversation,
                guid: data.guid,
                username: user.username,
                avatar: user.avatar,
                message: Base64.encode( message )
            }
        }

        result = await dbase.getOne( queries.retrieve, [ conversation ] );
        let server:string = await getter( "USER-" + ( result.user1 === user.id ? result.user2 : result.user1 ) );

        if( !blocked ) {
            if( server ) redis.publish( server, JSON.stringify( { command:"CHAT_MESSAGE", user: result.user1 === user.id ? result.user2 : result.user1, packet } ) );
            else {
                console.log( "SENT NOTIFICATION REQUEST" );
                redis.publish( "SEND_NOTIFICATION", JSON.stringify( { userid:result.user1 === user.id ? result.user2 : result.user1, type:"mail", message: user.username + " sent you a message" } ) );
            }
        }
        return packet;
    }

    private async getConversation( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'getConversation' );

        const page:number = data.page || 1;
        const perPage:number = data.perPage || 30;

        const queries:JSONObject = {            
            user: `SELECT id, avatar FROM users WHERE username = ?`,
            conversation: `SELECT id FROM conversations WHERE ( user1 = ? AND user2 = ? ) OR ( user1 = ? AND user2 = ? )`,
            create: `INSERT INTO conversations SET user1 = ?, user2 = ?`,
            retrieve: `SELECT sender, message, ( UNIX_TIMESTAMP() - sent ) AS since FROM messages WHERE conversation = ? AND IF( sender = ?, sender_view, recipient_view ) = 1 ORDER BY messages.id DESC`,// LIMIT ?,?`,            
            markRead: `UPDATE messages SET seen = 1 WHERE conversation = ? AND sender <> ?`// AND id >= ? AND id <= ?`
        }
        
        const userData:RowDataPacket = await dbase.getOne( queries.user, [ data.with ] );

        let conversation:number = -1;
        if( data.chat === 0 ) {
            let conversationData:RowDataPacket = await dbase.getOne( queries.conversation, [ user.id, userData.id, userData.id, user.id ] );            
            if( conversationData === undefined ) {
                conversationData = await dbase.query( queries.create, [ user.id, userData.id ] );            
                conversation = conversationData[ 0 ].insertId;
            } else conversation = conversationData.id;
        } else conversation = data.chat;
                
        const chatData:RowDataPacket = await dbase.get( queries.retrieve, [ conversation, user.id, ( page - 1 ) * perPage, perPage ] );
        let result:RowDataPacket = await dbase.query( queries.markRead, [ conversation, user.id ] );        

        return {
            conversation,
            avatar: userData.avatar,
            username: data.with,
            messages: chatData.map( data => {
                data.sender = user.id == data.sender;
                data.message = Base64.encode( data.message );
                return data;
            } )
        }
    }

    private async getConversations( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'getConversations: ' + data.page );

        const start:number = Date.now();
        
        const queries = {
            count: "SELECT COUNT(conversations.id) AS total FROM conversations INNER JOIN conversations_users ON conversations.id = conversations_users.conversation AND userid = ?",
            retrieve: "SELECT conversations.id, sender, message, sent AS since, username, avatar FROM conversations LEFT JOIN conversations_users ON conversations_users.conversation = conversations.id INNER JOIN users ON users.id = if( user1 = ?, user2, user1 ) WHERE ( user1 = ? or user2 = ? ) AND userid = ? ORDER BY sent DESC LIMIT ?,?"
        }        
    
        const count:RowDataPacket = await dbase.getOne( queries.count, [ user.id ] );        

        const page:number = data.page || 1;
        const perPage:number = data.perPage || 20;
        const result:RowDataPacket[] = await dbase.get( queries.retrieve, [ user.id, user.id, user.id, user.id, ( page - 1 ) * perPage, perPage ] );        

        const finish:number = Date.now();
        console.log( "Duration: " + ( finish - start ) );
        return {
            page,
            maxPage: Math.ceil( count.total / perPage ),
            conversations: result.map( data => {
                data.sender = user.id == data.sender;
                data.seen = data.sender ? true : data.seen;
                data.message = Base64.encode( data.message );
                return data;
            } )
        };
    }

    private async getShouts( user:User ):Promise<JSONObject> {
        this.debug( 'getShouts' );

        const query:string = `SELECT username, avatar, time, shout FROM shoutbox INNER JOIN users ON userid = users.id WHERE ( deleted = 0 OR shoutbox.userid = ? ) AND shoutbox.userid NOT IN ( SELECT contactid AS userid FROM contacts WHERE userid = ? AND type='blocked' ) ORDER BY shoutbox.id DESC LIMIT 30`;
        const result:RowDataPacket[] = await dbase.query( query, [ user.id, user.id ] );        

        for( let i:number = 0; i < result[ 0 ].length; i++ ) {
            result[ 0 ][ i ].shout = Base64.encode( result[ 0 ][ i ].shout );
        }        
        
        return result[ 0 ];
    }

    private async joinShoutbox( user:User, connection:WebSocket.connection ):Promise<JSONObject> {
        this.debug( 'joinShoutbox' );

        this._connections[ user.id ] = connection;

        return { type:'SHOUTBOX_JOINED' };
    }

    private async leaveShoutbox( user:User, connection:WebSocket.connection ):Promise<JSONObject> { 
        this.debug( 'leaveShoutbox' );

        delete this._connections[ user.id ];

        return { type:'SHOUTBOX_LEFT' };
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'ChatsController: ' + msg );
    }
}