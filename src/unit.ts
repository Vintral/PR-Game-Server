import logger from './logger';
import dbase from './database';

export default class Unit {
    private _debug:boolean = true;

    private id:Number = -1;
    private type:string = "";
    private name:string = "";
    private plural:string = "";

    private attack:number = 0;
    private defense:number = 0;
    private power:number = 0;
    private health:number = 0;

    private ranged:boolean = false;

    private costGold:number = 0;
    private costPoints:number = 0;
    private upkeepGold:number = 0;
    private upkeepFood:number = 0;
    private upkeepWood:number = 0;
    private upkeepFaith:number = 0;
    private upkeepStone:number = 0;
    private upkeepMana:number = 0;

    private available:boolean = false;
    private recruitable:boolean = false;

	constructor( id ) {
		this.id = id;		
	}
	
	//======================//
	//	Methods				//
	//======================//
	async load():Promise<void> {
		this.debug( "load" );
			
		const data = await dbase.getOne( "SELECT * FROM units WHERE id = " + this.id + " LIMIT 1" );						
        this.parseData( data );
	}
	
    parseData( data:any ):void {
        this.type = data.type;
        this.name = data.name;
        this.plural = data.plural;
        
        this.ranged = data.ranged;
        this.attack = parseFloat( data.attack );
        this.defense = parseFloat( data.defense );
        this.power = ( this.attack + this.defense ) / ( 1 + ( this.ranged ? 1 : 0 ) );
        
        this.health = parseInt( data.health );
        
        this.costGold = parseInt( data.cost_gold );
        this.costPoints = parseInt( data.cost_points );
        
        this.upkeepGold = parseFloat( data.upkeep_gold );
        this.upkeepFood = parseFloat( data.upkeep_food );
        this.upkeepWood = parseFloat( data.upkeep_wood );
        this.upkeepStone = parseFloat( data.upkeep_stone );
        this.upkeepFaith = parseFloat( data.upkeep_faith );
        this.upkeepMana = parseFloat( data.upkeep_mana );
        
        this.available = data.available;
        this.recruitable = data.recruitable;
    }
    
    clone():Unit {
        return { ...this };
    }

	debug( msg:string ):void {
		if( this._debug ) 
			logger.logServer( 'Unit: ' + msg );
	}
}