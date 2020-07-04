import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import { User } from '../models';
import { Base64 } from 'js-base64';

export default class ConversationsController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<JSONObject> {        
        try {
            console.log( data );
            switch( data.command ) {
                case 'get_conversations': return { type:'CONVERSATIONS', data: await this.getConversations( user, data ) };
                case 'get_conversation': return { type:'CONVERSATION', data: await this.getConversation( user, data ) };
            }
        } catch( err ) {
            console.log( 'ERROR: ' + err );
        }

        return { type:'ERROR', data:'Conversations Error' };
    }

    private async getConversation( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'getConversation' );

        const page:number = data.page || 1;
        const perPage:number = data.perPage || 30;

        const queries = {
            user: `SELECT id, avatar FROM users WHERE username = ?`,
            count: `SELECT COUNT(messages.id) AS total FROM messages INNER JOIN conversations ON conversations.id = messages.conversation AND ( ( user1 = ? AND user2 = ? ) OR ( user1 = ? AND user2 = ? ) ) WHERE IF( sender = ?, sender_view, recipient_view ) = 1`,
            retrieve: `SELECT sender, message, ( UNIX_TIMESTAMP() - sent ) AS since FROM messages INNER JOIN conversations ON conversations.id = messages.conversation AND ( ( user1 = ? AND user2 = ? ) OR ( user1 = ? AND user2 = ? ) ) WHERE IF( sender = ?, sender_view, recipient_view ) = 1 ORDER BY messages.id DESC`
        }

        const userData:RowDataPacket = await dbase.getOne( queries.user, [ data.with ] );
        const countData:RowDataPacket = await dbase.getOne( queries.count, [ user.id, userData.id, userData.id, user.id, user.id ])
        const chatData:RowDataPacket = await dbase.get( queries.retrieve, [ user.id, userData.id, userData.id, user.id, user.id, ( page - 1 ) * perPage, perPage ] );

        return {
            avatar: userData.avatar,
            pages: Math.ceil( countData.total / perPage ),
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

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'ConversationsController: ' + msg );
    }
}