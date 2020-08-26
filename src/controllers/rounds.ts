import logger from '../logger';
import Round from '../models/round';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import chalk from 'chalk';
import { User } from '../models';
import { PRECISION, LAND_PRECISION } from '../constants';

export default class RoundsController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<any> {
        switch( data.command ) {
            case 'get_active_rounds': return await this.getActiveRounds( user );
            case 'get_finished_rounds': return await this.getFinishedRounds( data, user );
            case 'join_round': return { type:'ROUND_JOINED', data: await this.joinRound( data, user ) };
            case 'play_round': return { type:'ROUND_SWITCHED', data: await this.playRound( data, user ) };

            default: console.log( 'Unhandled Command: ' + data.command );
        }        
    }

    private async getActiveRounds( user:User ):Promise<JSONObject> {
        this.debug( 'getActiveRounds' );        

        const query:string = `SELECT rounds.id, rounds.energy, rounds.max_energy, ( expires - UNIX_TIMESTAMP() ) AS time, IF( roundid IS NOT NULL, 1, 0 ) AS playing FROM rounds LEFT JOIN ( SELECT id, roundid FROM users_rounds WHERE userid = ? ) as u ON rounds.id = u.roundid WHERE active = 1`;
        const result:RowDataPacket[] = await dbase.get( query, [ user.id ] );

        let rounds:Array<JSONObject> = new Array<Round>();
        for( let i:number = 0; i < result.length; i++ ) {
            rounds.push( new Round( result[ i ] ).trim() );
        }

        return { type:'ACTIVE_ROUNDS', data: { page:0, rounds } };
    }

    private async getFinishedRounds( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'getFinishedRounds' );

        const page:number = data.page || 1;
        const perPage:number = data.perPage || 10;

        const queries:JSONObject = {
            count: `SELECT COUNT(id) AS total FROM rounds WHERE active = 0`,
            retrieve: 'SELECT rounds.id, rounds.energy, rounds.max_energy, ( UNIX_TIMESTAMP() - expires ) AS time, `rank`, tier, earned FROM rounds LEFT JOIN rankings ON rounds.id = rankings.round AND userid = ? WHERE active = 0 ORDER BY expires DESC LIMIT ?,?'
        }
        
        const count:RowDataPacket = await dbase.getOne( queries.count );
        const result:RowDataPacket[] = await dbase.get( queries.retrieve, [ user.id, ( page - 1 ) * perPage, perPage ] );

        let rounds:Array<JSONObject> = new Array<Round>();
        let round:Round;
        for( let i:number = 0; i < result.length; i++ ) {
            round = new Round( result[ i ] );
            const { rank, tier, earned, time } = result[ i ];
            rounds.push( { ...round.trim(), rank, tier, earned } );
        }

        return { type:'FINISHED_ROUNDS', data: { page, maxPages:Math.ceil( count.total / perPage ), rounds } };
    }

    private async loadRound( id:number, user:User ):Promise<Round|null> {
        this.debug( 'loadRound' );
        
        const queries = {
            round:`SELECT * FROM rounds WHERE id = ?`,
            playing:`SELECT id FROM users_rounds WHERE userid = ? AND roundid = ?`
        }
        
        const result:RowDataPacket = await dbase.getOne( queries.round, [ id ] );
        if( !result ) return null;

        const playing:RowDataPacket = await dbase.getOne( queries.playing, [ user.id, id ] );

        const round:Round = new Round( result );
        if( playing ) round.playing = true;

        return round;  
    }

    private async joinRound( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'joinRound' );        

        const roundid:number = data.round || -1;

        const queries = {
            createUserRound:`INSERT INTO users_rounds ( userid, roundid, land, land_free, gold, food, wood, metal, stone, energy, active ) VALUES ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1 )`,
            updateUser:`UPDATE users SET current_round = ? WHERE id = ?`,
        }

        try {
            const round:Round|null = await this.loadRound( roundid, user );
            if( round == null ) throw new Error( 'Invalid Round' );
            
            let result:RowDataPacket[] = await dbase.query( queries.createUserRound, [ user.id, round.id, round.land * LAND_PRECISION, round.land * LAND_PRECISION, round.gold, round.food, round.wood, round.metal, round.stone, round.maxEnergy ] );
            if( result[ 0 ].affectedRows !== 1 ) throw new Error( 'Error(1) Joining Round' );

            result = await dbase.query( queries.updateUser, [ roundid, user.id ] );
            if( result[ 0 ].affectedRows !== 1 ) throw new Error( 'Error(2) Joining Round' );            

            await user.load();
            return { round:round.id, user:user.trim() };
        } catch( err ) { 
            console.log( chalk.red( 'Error: ' + err ) );            
        }
        
        return {};
    }    

    private async playRound( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'playRound' );

        const round:number = data.round || -1;

        try {
            const query:string = `UPDATE users SET current_round = ? WHERE id = ?`;
            const result:RowDataPacket[] = await dbase.query( query, [ round, user.id ] );
            if( result[ 0 ].affectedRows !== 1 ) throw new Error( 'Error Playing Round' );

            user.round = round;
            await user.loadRoundData();
            return { type:'ROUND_SWITCHED', data: { round, user:user.trim() } };
        } catch( err ) {
            console.log( chalk.red( 'Error: ' + err ) );
        }

        return {};
    }

    private error( msg:string ):JSONObject {
        this.debug( 'error: ' + msg );

        let packet:JSONObject = {};
        packet.type = 'ERROR';
        packet.message = msg;
        return packet;
    }

    /*async getRounds() {
		this.debug( "getRounds" );
		
		var query = "SELECT rounds.id, rounds.energy, rounds.max_energy, IF( roundid IS NOT NULL, 1, 0 ) AS playing FROM rounds LEFT JOIN ( SELECT id, roundid FROM users_rounds WHERE userid = " + this.id + " ) as u ON rounds.id = u.roundid WHERE active = 1";
		
		const rounds = await dbase.get( query );
		if( rounds ) this.dispatch( "ROUND_LIST", rounds );		
	}

	async getFinishedRounds( page ) {
		this.debug( "getPastRounds: " + page );
		if( !page || page < 0 ) {
			logger.logError( "getPastRounds: Invalid page: " + page );
			return this.dispatchError( "Error Retrieving Finished Rounds" );
		}
		
		const perPage = 10;
		const query = "SELECT id FROM rounds WHERE active = 0 ORDER BY expires DESC LIMIT " + ( ( page - 1 ) * perPage ) + "," + perPage;
		console.log( query );
		const rounds = await dbase.get( query );
		console.log( rounds );

		this.dispatch( "FINISHED_ROUND_LIST", { test:"123" } );
	}*/

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'RoundsController: ' + msg );
    }
}