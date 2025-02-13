import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import * as WebSocket from 'websocket';
import { JSONObject } from '../interfaces';
import { User } from '../models';
import { Base64 } from 'js-base64';

export default class MarketsController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<JSONObject> {        
        try {
            console.log( data );
            switch( data.command ) {
                case 'buy_item': return await this.buyItem( data, user );
                case 'sell_item': return await this.sellItem( data, user );
                case 'get_markets': return { type:'MARKETS', data: await this.getMarketInfo( user ) };
            }
        } catch( err ) {
            console.log( 'ERROR: ' + err );
        }

        return { type:'ERROR', data:'Markets Error' };
    }    

    private async buyItem( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'buyItem' );

        try {
            console.log( 'User Has: ' + user[ data.type ] );            

            let { type, amount } = data;
            amount = parseInt( amount );

            if( amount <= 0 ) return this.error( 'Invalid Amount' );

            const queries:JSONObject = {
                retrieve: `SELECT ( total_sold - total_bought ) AS available, price FROM market WHERE type = ? AND roundid = ?`,
                update: `UPDATE market SET total_bought = total_bought + ? WHERE roundid = ? AND type = ?`,
            }
            
            let result:RowDataPacket = await dbase.getOne( queries.retrieve, [ type, user.round ] );

            const price:number = amount * result.price;
            const available:number = parseInt( result.available );

            if( user.gold < price * amount ) return this.error( `Cannot Afford` );
            if( amount > available ) return this.error( 'Not Enough Available' );

            const before:number = parseInt( user.gold.toString() );
            user[ type ] += amount;
            user.gold -= price;
            const success:boolean = await user.commit();
            if( !success ) return this.error( 'Error Buying' );

            const after:number = parseInt( user.gold.toString() );
            console.log( user.trim() );
            
            result = await dbase.query( queries.update, [ amount, user.round, type ] );
            if( !result ) logger.logError( `Error Updating Market's Bought - ${user.round} - ${type}` );

            return { type:'BOUGHT', data: { type, amount, available: ( available - amount ), price:( before - after ) } };
        } catch( err ) {
            console.log( err );
            return { type:'MARKET_ERROR', data:{ error: err } };
        }

        return {};
    }

    private async sellItem( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'sellItem' );

        try {
            console.log( 'User Has: ' + user[ data.type ] );

            let { type, amount } = data;
            amount = parseInt( amount );
            if( amount <= 0 ) return this.error( 'Invalid Amount' );

            if( user[ type ] < amount ) return this.error( 'Not enough ' + type );

            const queries:JSONObject = {
                retrieve: `SELECT ( total_sold - total_bought ) AS available, price FROM market WHERE type = ? AND roundid = ?`,
                update: `UPDATE market SET total_sold = total_sold + ? WHERE roundid = ? AND type = ?`,
            }
            
            let result:RowDataPacket = await dbase.getOne( queries.retrieve, [ type, user.round ] );

            const price:number = result.price * amount;
            const available:number = parseInt( result.available );

            const before:number = parseInt( user.gold.toString() );
            user[ data.type ] -= amount;
            user.gold += price;
            const success:boolean = await user.commit();
            if( !success ) return this.error( 'Error Selling' );

            const after:number = parseInt( user.gold.toString() );

            console.log( user.trim() );
            
            result = await dbase.query( queries.update, [ amount, user.round, type ] );
            if( !result ) logger.logError( `Error Updating Market's Sold - ${user.round} - ${type}` );

            return { type:'SOLD', data: { type, amount, price:( after - before ), available:( available + amount ) } };
        } catch( err ) {
            return { type:'MARKET_ERROR', err:err };
        }

        return {};
    }

    private async getMarketInfo( user:User ):Promise<JSONObject> {
        this.debug( 'getMarketInfo' );

        const query:string = `SELECT type, price, ( total_sold - total_bought ) AS available FROM market WHERE roundid = ?`
        const result:RowDataPacket[] = await dbase.get( query, [ user.round ] );
        return result;
    }

    private error( err:string ):JSONObject {
        this.debug( 'error: ' + err );
        return { type:'MARKET_ERROR', data:err }
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'MarketsController: ' + msg );
    }
}