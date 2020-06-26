import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import * as WebSocket from 'websocket';
import { JSONObject } from '../interfaces';
import { User } from '../models';
import { Base64 } from 'js-base64';

export default class ChatsController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User, connection:WebSocket.connection  ):Promise<JSONObject> {        
        try {
            console.log( data );
            switch( data.command ) {
                case 'get_conversations': return { type:'CONVERSATIONS', data: await this.getConversations( user, data ) };
                case 'get_conversation': return { type:'CONVERSATION', data: await this.getConversation( user, data ) };
                case 'get_shouts': return { type:'SHOUTS', data: await this.getShouts( user ) };
                case 'join_shoutbox': return { type:'SHOUTBOX_JOINED', data: await this.joinShoutbox( user, connection ) };
                case 'leave_shoutbox': return { type:'SHOUTBOX_LEFT', data: await this.leaveShoutbox( user, connection  ) };
                case 'send_message': return { type:'MESSAGE_SENT', data: await this.sendMessage( user, data ) };
                case 'contact': return { type:'CONTACT_SUBMITTED', data: await this.submitContact( user, data ) };
            }
        } catch( err ) {
            console.log( 'ERROR: ' + err );
        }

        return { type:'ERROR', data:'Conversations Error' };
    }

    private async submitContact( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'submitContact' );

        const query:string = `INSERT INTO contact_submissions ( userid, roundid, message, time, viewed ) VALUES ( ?, ?, ?, UNIX_TIMESTAMP(), 0 )`;
        const result:RowDataPacket = await dbase.query( query, [ user.id, user.round, data.message ] );

        return {};
    }

    private async sendMessage( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'sendMessage' );

        let { to, message } = data;
        message = Base64.decode( message );

        const queries:JSONObject = {
            receiver: `SELECT id FROM users WHERE username = ?`,
            exists: `SELECT id FROM conversations WHERE ( user1 = ? AND user2 = ?) OR ( user1 = ? AND user2 = ? )`,
            create: `INSERT INTO conversations ( user1, user2 ) VALUES ( ?, ? )`,
            blocked: `SELECT id FROM contacts WHERE contactid = ? AND userid = ? AND type = 'blocked'`,
            insert: `INSERT INTO messages ( conversation, sender, message, sent, sender_view, recipient_view ) VALUES ( ?, ?, ?, UNIX_TIMESTAMP(), ?, ? )`
        };

        let result:RowDataPacket = await dbase.getOne( queries.receiver, [ to ] );
        if( !result ) throw new Error( 'Recipient not found' );
        console.log( result );

        const receiverID:number = +result.id;

        result = await dbase.getOne( queries.exists, [ user.id, receiverID, receiverID, user.id ] );
        console.log( result );
        if( !result ) {
            result = await dbase.query( queries.create, [ user.id, receiverID ] );
            console.log( result );
        }        

        const conversation:number = result.id;

        result = await dbase.getOne( queries.blocked, [ receiverID, user.id ] );
        console.log( result );
        const blocked:boolean = result !== null;

        result = await dbase.query( queries.insert, [ conversation, user.id, message, 1, blocked ? 0 : 1 ] );
        console.log( result );

        data.message = Base64.decode( data.message );
        return { message: Base64.encode( data.message ) };
    }

    private async getConversation( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'getConversation' );

        const page:number = data.page || 1;
        const perPage:number = data.perPage || 30;

        const queries:JSONObject = {
            user: `SELECT id, avatar FROM users WHERE username = ?`,
            count: `SELECT COUNT(messages.id) AS total FROM messages INNER JOIN conversations ON conversations.id = messages.conversation AND ( ( user1 = ? AND user2 = ? ) OR ( user1 = ? AND user2 = ? ) ) WHERE IF( sender = ?, sender_view, recipient_view ) = 1`,
            retrieve: `SELECT sender, message, ( UNIX_TIMESTAMP() - sent ) AS since FROM messages INNER JOIN conversations ON conversations.id = messages.conversation AND ( ( user1 = ? AND user2 = ? ) OR ( user1 = ? AND user2 = ? ) ) WHERE IF( sender = ?, sender_view, recipient_view ) = 1 ORDER BY messages.id DESC LIMIT ?,?`
        }

        const userData:RowDataPacket = await dbase.getOne( queries.user, [ data.with ] );
        const countData:RowDataPacket = await dbase.getOne( queries.count, [ user.id, userData.id, userData.id, user.id, user.id ])
        const chatData:RowDataPacket = await dbase.get( queries.retrieve, [ user.id, userData.id, userData.id, user.id, user.id, ( page - 1 ) * perPage, perPage ] );
        console.log( chatData.length );

        return {
            avatar: userData.avatar,
            pages: Math.ceil( countData.total / perPage ),
            page,
            messages: chatData.map( data => {
                data.sender = user.id == data.sender;
                data.message = Base64.encode( data.message );
                return data;
            } )
        }
    }

    private async getConversations( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'getConversations: ' + data.page );
        
        const queries = {
            count: `SELECT COUNT(id) as total FROM ( SELECT conversations.id, COUNT(conversation) AS total FROM conversations INNER JOIN messages ON conversation = conversations.id AND ( ( sender_view = 1 AND sender = ? ) OR ( recipient_view = 1 ) ) WHERE user1 = ? OR user2 = ? GROUP BY conversation ) as A;`,
            retrieve: `SELECT * FROM ( SELECT username, avatar, message, ( UNIX_TIMESTAMP() - sent ) AS since, seen, sender FROM conversations INNER JOIN users ON users.id = IF( user1 = 2, user2, user1 ) INNER JOIN messages ON conversation = conversations.id WHERE ( user1 = ? OR user2 = ? ) AND ( ( sender_view = 1 AND sender = ? ) OR ( recipient_view = 1 ) ) ORDER BY sent DESC LIMIT 1 ) AS a LIMIT ?,?`,
        }
        
        const count:RowDataPacket = await dbase.getOne( queries.count, [ user.id, user.id, user.id ] );        

        const page:number = data.page || 1;
        const perPage:number = data.perPage || 20;
        const result:RowDataPacket[] = await dbase.get( queries.retrieve, [ user.id, user.id, user.id, ( page - 1 ) * perPage, perPage ] );

        return {
            page,
            pages: Math.ceil( count.total / perPage ),
            conversations: result.map( data => {
                data.sender = user.id == data.sender;
                data.message = Base64.encode( data.message );
                return data;
            } )
        };
    }

    private async getShouts( user:User ):Promise<JSONObject> {
        this.debug( 'getShouts' );

        const query:string = `SELECT username, avatar, time, shout FROM shoutbox INNER JOIN users ON userid = users.id WHERE shoutbox.userid NOT IN ( SELECT contactid AS userid FROM contacts WHERE userid = ? AND type='blocked' ) ORDER BY shoutbox.id DESC LIMIT 30`;
        const result:RowDataPacket[] = await dbase.query( query, [ user.id ] );        

        for( let i:number = 0; i < result[ 0 ].length; i++ ) {
            result[ 0 ][ i ].shout = Base64.encode( result[ 0 ][ i ].shout );
        }        
        
        return result[ 0 ];
    }

    private async joinShoutbox( user:User, connection:WebSocket.connection ):Promise<JSONObject> {
        this.debug( 'joinShoutbox' );
        return {};
    }

    private async leaveShoutbox( user:User, connection:WebSocket.connection ):Promise<JSONObject> { 
        this.debug( 'leaveShoutbox' );
        return {}
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'ChatsController: ' + msg );
    }
}