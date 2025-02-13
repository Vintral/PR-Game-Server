var	EventEmitter = require("events").EventEmitter;

import logger from './logger';
import dbase from './database';
import Unit from './unit';

export default class UnitManager extends EventEmitter {
    private unitsByID:Array<Unit> = Array<Unit>();
    private unitsByType:Array<Unit> = Array<Unit>();

    constructor() {
        super();
        console.log( "UnitManager: CREATED" );
    }

	onUnitsUpdated() {
		this.debug( "onUnitsUpdated" );
		this.loadUnits();
	}
	
	async loadUnits():Promise<void> {
        this.debug( "loadUnits" );
        		
        const units = await dbase.get( "SELECT id FROM units" );
        
        let unitsByID:Array<Unit> = Array<Unit>();
        let unitsByType:Array<Unit> = Array<Unit>();
        let unit;
        for( let u in units ) {
            unit = new Unit( units[ u ].id );
            await unit.load();
                                    
            unitsByID[ unit.id ] = unit;
            unitsByType[ unit.type ] = unit;				
        }					
        
        this.unitsByID = unitsByID;
        this.unitsByType = unitsByType;
	}	
	
	Update() {
		this.debug( "Update" );
		this.loadUnits();
	}
	
	getUnitByType( $unit ):Unit|null {
		if( this.unitsByType[ $unit ] )
            return this.unitsByType[ $unit ].clone();
            
        return null;
	}
	
	getUnitByID( unit ):Unit|null {
		if( this.unitsByID[ unit ] )
            return this.unitsByID[ unit ].clone();
            
        return null;
	}
	
	debug( msg ):void {
		logger.logServer( "UnitManager: " + msg );
	}
}