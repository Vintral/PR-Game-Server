import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import * as WebSocket from 'websocket';
import { JSONObject } from '../interfaces';
import { User } from '../models';
let UUID = require( 'uuid/v4' );

export default class JobsController {
    private _debug:boolean = true;
    private _redis:any = '';

    private _requests:JSONObject = {};

    constructor( redis:any ) {
        this._redis = redis;
    }

    public async process( data:JSONObject, user:User, guid:any, connection:WebSocket.connection ):Promise<void> {
        this.debug( 'process' );
        console.log( data );

        switch( data.command ) {
            case 'get_jobs': this.getJobs( user, guid, connection ); break;
            default: this.debug( 'Unhandled Command: ' + data.command );
        }
    }

    public async processResponse( data:JSONObject ):Promise<boolean> {
        this.debug( 'processResponse' );
        console.log( data );                

        switch( data.command ) {
            case 'JOBS': {
                let packet:JSONObject = {};
                packet.type = 'JOBS';
                packet.data = data.packet;
                this._requests[ data.request ].sendUTF( JSON.stringify( packet ) );

                delete this._requests[ data.request ];                
            } break;
        }


        /*if( this._requests[ data.request ] != null ) {
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
        }*/

        return false;
    }

    private async getJobs( user:User, guid:string, connection:WebSocket.connection ):Promise<void> {
        this.debug( 'getJobs' );

        const request:any = UUID();
        this._requests[ request ] = connection;
        this._redis.publish( 'GET_JOBS', JSON.stringify( { server:guid, userid:user.id, request } ) );
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'JobsController: ' + msg );
    }
}