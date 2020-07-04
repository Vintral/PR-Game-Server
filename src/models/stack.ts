import { RowDataPacket } from 'mysql2/promise';
import { JSONObject, Costs, Upkeeps } from '../interfaces';
import Unit from './unit';

export default class Stack {
    //==============================//
    //  Properties                  //
    //==============================//
    private _units:Array<Unit> = Array<Unit>();

    //==============================//
    //  Accessors                   //
    //==============================//
    get units():Array<Unit> { return this._units; }
    
    //==============================//
    //  Methods                     //
    //==============================//
    public add( unit:Unit ) {
        if( this._units.length === 0 ) {
            this._units.push( unit );            
        } else {
            for( let i:number = 0; i < this._units.length; i++ ) {
                if( unit.power > this._units[ i ].power ) {
                    this._units.splice( i, 0, unit );
                }
            }
        }
    }

    public clone():Stack {
        return { ...this };
    }
}