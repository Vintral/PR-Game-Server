import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';

export default class LibraryController {
    private _debug:boolean = true;

    public async process( data:JSONObject ):Promise<JSONObject> {        
        switch( data.command ) {
            case 'get_news': return { type:'NEWS', data: await this.getNews() };
            case 'get_rules': return { type:'RULES', data: await this.getRules() };
            case 'get_buildings': return { type:'BUILDINGS', data: await this.getBuildings() };
            case 'get_units': return { type:'UNITS', data: await this.getUnits() };
            case 'get_items': return { type:'ITEMS', data: await this.getItems() };
        }

        return { type:'ERROR', data:'Library Error' };
    }

    private async getRules():Promise<JSONObject> {
        this.debug( 'getRules' );

        const query:string = `SELECT rule FROM rules ORDER BY position`;
        const result:RowDataPacket[] = await dbase.get( query );        
        return result;
    }

    private async getNews():Promise<JSONObject> {
        this.debug( 'getNews' );

        const query:string = `SELECT title, body, date FROM news ORDER BY id DESC`;
        const result:RowDataPacket[] = await dbase.get( query );        
        return result;
    }

    private async getBuildings():Promise<JSONObject> {
        this.debug( 'getBuildings' );

        const query:string = `SELECT * FROM buildings WHERE available = 1 ORDER BY display_position`;
        const result:RowDataPacket[] = await dbase.get( query );
        return result;
    }

    private async getUnits():Promise<JSONObject> {
        this.debug( 'getUnits' );

        const query:string = `SELECT * FROM units WHERE available = 1 ORDER BY display_position`;
        const result:RowDataPacket[] = await dbase.get( query );
        return result;
    }

    private async getItems():Promise<JSONObject> {
        this.debug( 'getItems' );

        const query:string = `SELECT id, name, type, description, effect, cost FROM items WHERE available = 1`;
        const result:RowDataPacket[] = await dbase.get( query );
        return result;
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'LibraryController: ' + msg );
    }
}