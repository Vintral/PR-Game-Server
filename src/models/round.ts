import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';

export default class Round {
    //==============================//
    //  Properties                  //
    //==============================//
    private _id:number;
    private _energy:number;
    private _maxEnergy:number;
    private _playing:boolean;
    private _land:number;
    private _gold:number;
    private _food:number;
    private _wood:number;
    private _stone:number;
    private _metal:number;
    private _active:boolean;
    private _recurring:boolean;
    private _processed:boolean;
    private _days:number;
    private _time:number;

    //==============================//
    //  Accessors                   //
    //==============================//
    set playing( value:boolean ) { this._playing = value; }

    get id():number { return this._id; }
    get land():number { return this._land; }
    get gold():number { return this._gold; }
    get food():number { return this._food; }
    get wood():number { return this._wood; }
    get stone():number { return this._stone; }
    get metal():number { return this._metal; }
    get maxEnergy():number { return this._maxEnergy; }
    get time():number { return this._time; }

    //==============================//
    //  Constructor                 //
    //==============================//
    constructor( data:RowDataPacket ) {
        this._id = data.id;
        this._energy = data.energy;
        this._maxEnergy = data.max_energy;
        this._playing = data.playing;

        this._land = data.land || -1;
        this._gold = data.gold || -1;
        this._food = data.food || -1;
        this._wood = data.wood || -1;
        this._metal = data.metal || -1;
        this._stone = data.stone || -1;
        this._active = data.active || false;
        this._recurring = data.recurring || false;
        this._processed = data.processed || false;
        this._days = data.days || -1;

        this._time = data.time || -1;
    }

    //==============================//
    //  Methods                     //
    //==============================//
    public trim():JSONObject {
        const { _id: id, _energy: energy, _maxEnergy: maxEnergy, _playing: playing, _time:time } = this;
        return { id, energy, maxEnergy, playing, time };
    }
}