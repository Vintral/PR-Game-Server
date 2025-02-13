import logger from './logger';

class Building {	
	constructor( $id ) {
		this._debug = true;
		
		this.id = $id;		
		
		this.type = "";
		this.name = "";
		this.plural = "";
		
		this.costWood = 0;
		this.costStone = 0;
		this.costPoints = 0;

		this.label = 0.00;
		
		this.field = "";
		this.bonus = 0.00;
		
		this.available = false;
	}
	
	//======================//
	//	Methods				//
	//======================//
	async load() {
		if( dbase ) {
			this.debug( "load" );
			
			this.data = await dbase.getOne( "SELECT * FROM buildings WHERE id = " + this.id + " LIMIT 1" );						
			this.parseData();
		}
	}
	
	parseData() {
		if( this.data ) {
			this.type = this.data.type;
			this.name = this.data.name;
			this.plural = this.data.plural;
			
			this.costWood = parseInt( this.data.cost_wood );
			this.costStone = parseInt( this.data.cost_stone );
			this.costPoints = parseFloat( this.data.cost_points );
			
			this.field = this.data.field;
			this.bonus = parseFloat( this.data.bonus );
			
			this.available = this.data.available;
		}
	}
	
	clone() {
		var ret = new Building( this.id );
		
		ret.data = this.data;
		ret.parseData();		
		delete ret.data;
		
		return ret;
	}

	debug( $msg ) {
		if( this._debug ) 
			logger.logServer( "Building: " + $msg );
	}
}


module.exports = Building;