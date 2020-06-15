import { RowDataPacket } from 'mysql2/promise';
import logger from "../logger";
import dbase from "../database";
import { Unit } from '../models';
import { JSONObject } from '../interfaces';

export default class UnitsProvider {
    private _debug:boolean = true;
    private _units:JSONObject = {};

    public async load():Promise<boolean> {
        this.debug( 'load' );

        const query:string = `SELECT * FROM units`;
        const result:RowDataPacket = await dbase.get( query );

        this._units = {};
        const units:Unit[] = result.forEach( unit => {
            unit = new Unit( unit );
            this._units[ unit.id ] = unit;
        } );

        return true;
    }

    public get( id:number ):Unit|null {
        return this._units[ id ];
    }

    private debug( msg:string, force:boolean = false, silence:boolean = true ):void {
        if( silence ) return;
        if( this._debug || force )
            logger.logServer( 'UnitsProvider: ' + msg );
    }
}