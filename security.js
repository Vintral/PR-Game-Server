var crypto = require( 'crypto' );

class Security {	
	constructor() {		
		this.algorithm = 'aes-256-ctr';
		this.salt = 'hu1@p1Atypu$';			
	}	
	
	encrypt( val ) {
		let cipher = crypto.createCipher( this.algorithm, this.salt );
		let ret = cipher.update( val, 'utf8', 'hex' );
		ret += cipher.final( 'hex' );
		return ret;
	}
		
	decrypt( val ) {		
		let cipher = crypto.createCipher( this.algorithm, this.salt );
		let ret = cipher.update( val, 'hex', 'utf8' );
		ret += cipher.final( 'utf8' );
		return ret;
	}
}

module.exports = new Security();