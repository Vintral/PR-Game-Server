import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import * as WebSocket from 'websocket';
import { JSONObject } from '../interfaces';
import { User } from '../models';
let UUID = require( 'uuid/v4' );

export default class RankingsController {
    private _debug:boolean = true;
    private _redis:any = '';

    private _requests:JSONObject = {};

    constructor( redis:any ) {
        this._redis = redis;
    }

    public async process( data:JSONObject, user:User, guid:any, connection:WebSocket.connection ):Promise<void> {
        switch( data.command ) {
            case 'get_near_ranks': await this.getRankingsNear( user, data, guid, connection ); break;
            case 'get_top_ranks': await this.getRankingsTop( user, data, guid, connection ); break;
        }
    }

    public async processResponse( data:JSONObject ):Promise<boolean> {
        this.debug( 'processResponse' );
        console.log( data );

        if( this._requests[ data.request ] != null ) {
            let packet:JSONObject = {};
            packet.type = 'RANKINGS';
            packet.data = {};
            packet.data.type = this._requests[ data.request ].type;
            packet.data.page = this._requests[ data.request ].page;

            let rank:number = data.start;
            packet.data.ranks = await Promise.all( data.ranks.map( async( ranking ) => {
                rank++;
                const username:string = ranking.split( '|||' )[ 0 ];
                const power:string = ranking.split( '|||' )[ 1 ];
                const response:RowDataPacket = await dbase.getOne( `SELECT avatar, land FROM users INNER JOIN users_rounds ON users_rounds.userid = users.id AND roundid = ? WHERE username = ?`, [ this._requests[ data.request ].round, username ] );
                const avatar:string = response.avatar;

                return { 
                    username, 
                    power, 
                    avatar, 
                    land:parseInt( Math.floor( response.land ).toString() ), 
                    rank:rank - 1 
                };
            } ) );
            console.log( packet );
            this._requests[ data.request ].connection.sendUTF( JSON.stringify( packet ) )
        }

        return false;
    }

    private async getRankingsNear( user:User, data:JSONObject, guid:any, connection:WebSocket.connection ):Promise<void> {
        this.debug( 'getRankingsNear' );

        if( this._redis ) {
            const req:any = UUID();

            let packet:JSONObject = {};
            packet.username = user.username;
            packet.roundid = user.round;
            packet.server = guid;
            packet.request = req;
            packet.page = data.page || 0;            

            this._requests[ req ] = {
                connection,
                type:'near',
                page:packet.page,
                round:user.round
            }

            this._redis.publish( 'GET_RANKINGS', JSON.stringify( packet ) );            
        }
    }

    private async getRankingsTop( user:User, data:JSONObject, guid:any, connection:WebSocket.connection ):Promise<void> {
        this.debug( 'getRankingsTop' );
        
        if( this._redis ) {
            const req:any = UUID();

            let packet:JSONObject = {};            
            packet.roundid = user.round;
            packet.server = guid;
            packet.request = req;
            packet.page = data.page || 0;            

            this._requests[ req ] = {
                connection,
                type:'top',
                page:packet.page,
                round:user.round
            }

            this._redis.publish( 'GET_TOP_RANKINGS', JSON.stringify( packet ) );            
        }
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'RankingsController: ' + msg );
    }
}