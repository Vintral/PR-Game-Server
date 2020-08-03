import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import * as WebSocket from 'websocket';
import { JSONObject } from '../interfaces';
import { User } from '../models';
import { LAND_PRECISION } from '../constants';
import chalk from 'chalk';
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

    private async processRank( rank:number, round:number, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'processRank: ' + JSON.stringify( data ) );

        rank = Math.floor( rank );

        const username:string = data.split( '|||' )[ 0 ];
        const power:string = data.split( '|||' )[ 1 ];
        const response:RowDataPacket = await dbase.getOne( `SELECT avatar, land FROM users INNER JOIN users_rounds ON users_rounds.userid = users.id AND roundid = ? WHERE username = ?`, [ round, username ] );
        if( !response ) return {};

        const avatar:string = response.avatar;
        return { 
            username, 
            power, 
            avatar, 
            land:parseInt( Math.floor( response.land / LAND_PRECISION ).toString() ), 
            rank
        };
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
            let round:number = this._requests[ data.request ].round;

            packet.data.ranks = [];            
            for( let i:number = 0; i < data.ranks.length; i++ ) {
                packet.data.ranks.push( await this.processRank( rank++, round, data.ranks[ i ] ) );
            }

            /*packet.data.ranks = await Promise.all( data.ranks.map( async( ranking ) => {
                rank++;
                const username:string = ranking.split( '|||' )[ 0 ];
                const power:string = ranking.split( '|||' )[ 1 ];
                const response:RowDataPacket = await dbase.getOne( `SELECT avatar, land FROM users INNER JOIN users_rounds ON users_rounds.userid = users.id AND roundid = ? WHERE username = ?`, [ this._requests[ data.request ].round, username ] );
                console.log( 'username: ' + username );
                console.log( 'Rank: ' + rank );
                console.log( response );
                if( !response ) return {};

                const avatar:string = response.avatar;

                return { 
                    username, 
                    power, 
                    avatar, 
                    land:parseInt( Math.floor( response.land / LAND_PRECISION ).toString() ), 
                    rank:rank - 1 
                };
            } ) );*/
            console.log( packet );
            try{
                this._requests[ data.request ].connection.sendUTF( JSON.stringify( packet ) )
            } catch( err ) {
                console.log( chalk.red( 'RANKING ERROR' ) );
                console.log( err );
            }
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