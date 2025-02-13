import { RowDataPacket } from 'mysql2/promise';
import { JSONObject, Costs, Upkeeps } from '../interfaces';

export default class Unit {
    //==============================//
    //  Properties                  //
    //==============================//
    private _id:number;
    private _type:string;
    private _name:string;
    private _plural:string;
    private _attack:number;
    private _defense:number;
    public _power:number;
    private _health:number;
    private _ranged:boolean;
    private _cost:Costs;
    private _upkeep:Upkeeps;
    private _available:boolean;
    private _recruitable:boolean;
    private _quantity:number;

    //==============================//
    //  Accessors                   //
    //==============================//
    get quantity():number { return this._quantity; }
    set quantity( value:number ) { this._quantity = value; }

    get id():number { return this._id; }
    get type():string { return this._type; }
    get name():string { return this._name; }
    get plural():string { return this._plural; }
    get attack():number { return this._attack; }
    get defense():number { return this._defense; }
    get power():number { return this._power; }
    get health():number { return this._health; }
    get ranged():boolean { return this._ranged; }
    get available():boolean { return this._available; }
    get recruitable():boolean { return this._recruitable; }
    get costs():Costs { return this._cost; }
    get costGold():number { return this._cost.gold; }
    get costPoints():number { return this._cost.points != null ? this._cost.points : 0; }
    get upkeep():Upkeeps { return this._upkeep; }
    get upkeepGold():number { return this._upkeep.gold; }
    get upkeepFood():number { return this._upkeep.food; }

    //==============================//
    //  Constructor                 //
    //==============================//
    constructor( data:RowDataPacket ) {
        this._id = data.id || -1;
        this._type = data.type || '';
        this._name = data.name || '';
        this._plural = data.plural || this._name + 's';
        this._attack = parseFloat( data.attack ) || 0;
        this._defense = parseFloat( data.defense ) || 0;        
        this._health = parseInt( data.health ) || 0;
        this._ranged = data.ranged === 1;
        this._available = data.available === 1;
        this._recruitable = data.recruitable === 1;
        this._power = ( this._attack + this._defense ) / ( 1 + ( this._ranged ? 1 : 0 ) );        

        this._cost = {
            gold: data.cost_gold || 0,
            food: 0,
            wood: 0,
            metal: 0,
            stone: 0,
            points: data.cost_points || 0
        }

        this._upkeep = {
            gold: data.upkeep_gold || 0,
            food: data.upkeep_food || 0,
            wood: 0,
            metal: 0,
            stone: 0,
        }

        this._quantity = 0;
    }

    //==============================//
    //  Methods                     //
    //==============================//
    doDamage( damage:number ):number {
        let killed:number = Math.floor( damage / this._health );
        
        if( killed > this._quantity ) killed = this._quantity;
        this._quantity -= killed;
        if( this._quantity < 0 ) this._quantity = 0;

        return killed;
    }

    fight( defender:Unit, bonus:number = 0 ):JSONObject|null {
        if( defender.quantity === 0 ) return null;

		let damage = Math.ceil( ( ( Math.random() * this._quantity * this._attack / 2) + ( this._quantity * this._attack / 2 ) ) * ( 100 - bonus ) / 100 );
		let killed = defender.doDamage( damage );		
				
		return { da:damage, k:killed };
	}

    public clone():Unit {
        return Object.create( this );
    }
}