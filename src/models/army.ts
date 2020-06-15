import logger from '../logger';
import { Unit } from '.';

export default class Army {
    //==============================//
    //  Properties                  //
    //==============================//
    private _debug:boolean = false;
    private _units:Array<Unit> = Array<Unit>();
    private _power:number = 0;

    //==============================//
    //  Accessors                   //
    //==============================//
    get units():Array<Unit> { return this._units; }
    get power():number { return this._units.reduce( ( power, unit ) => { return power + ( unit.quantity * unit.power ) }, 0 ); }
    
    //==============================//
    //  Methods                     //
    //==============================//
    public add( unit:Unit ) {
        this.debug( 'add' );

        this._power += ( unit.power * unit.quantity );

        if( this._units.length === 0 ) {
            this._units.push( unit );            
        } else {
            for( let i:number = 0; i < this._units.length; i++ ) {
                if( ( unit.power * unit.quantity ) >= ( this._units[ i ].power * this._units[ i ].quantity ) ) {
                    this._units.splice( i, 0, unit );
                    return;
                }
            }

            this._units.push( unit );
        }
    }

    public clear( keep:number = 1 ) {
        this.debug( 'clear: ' + keep );
        this._units = this._units.slice( 0, keep );
    }

    public clone():Army {
        return { ...this };
    }

    public condense():Array<string> {
        let ret:Array<string> = new Array<string>();

        this.units.forEach( unit => {
            ret.push( unit.id + ':' + unit.quantity );
        } );

        return ret;
    }

    private debug( msg:string, force:boolean = false, silence:boolean = false ) {
        if( silence ) return;
        if( this._debug || force )
            logger.logServer( 'Army: ' + msg );
    }
}