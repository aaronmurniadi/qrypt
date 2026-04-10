export namespace backend {
	
	export class DecryptedFile {
	    data: string;
	    mime: string;
	
	    static createFrom(source: any = {}) {
	        return new DecryptedFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = source["data"];
	        this.mime = source["mime"];
	    }
	}
	export class VaultFileEntry {
	    path: string;
	    mime: string;
	    plainSize: number;
	    isDir: boolean;
	
	    static createFrom(source: any = {}) {
	        return new VaultFileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.mime = source["mime"];
	        this.plainSize = source["plainSize"];
	        this.isDir = source["isDir"];
	    }
	}

}

