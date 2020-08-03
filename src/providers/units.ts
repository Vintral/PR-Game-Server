import { RowDataPacket } from 'mysql2/promise';
import logger from "../logger";
import dbase from "../database";
import { Unit } from '../models';
import { JSONObject } from '../interfaces';

export default class UnitsProvider {
    private _debug:boolean = true;
    private _unitsByID:JSONObject = {};
    private _unitsByType:JSONObject = {};

    private _redis:any;

    constructor( redis:any ) {
        this._redis = redis;
    }

    public async load():Promise<boolean> {
        this.debug( 'load' );

        const query:string = `SELECT * FROM units`;
        const result:RowDataPacket = await dbase.get( query );

        this._unitsByID = {};
        const units:Unit[] = result.forEach( unit => {
            unit = new Unit( unit );
            this._unitsByID[ unit.id ] = unit;
            this._unitsByType[ unit.type ] = unit;
        } );

        return true;
    }

    public get( id:number ):Unit|null {
        return this._unitsByID[ id ];
    }

    public getByType( type:string ):Unit|null {
        return this._unitsByType[ type ];
    }

    private debug( msg:string, force:boolean = false, silence:boolean = true ):void {
        if( silence ) return;
        if( this._debug || force )
            logger.logServer( 'UnitsProvider: ' + msg );
    }
}