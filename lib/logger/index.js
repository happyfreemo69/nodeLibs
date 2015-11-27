var fs = require('fs');
var path = require('path');
var util = require('util');
var Winston = require('winston');
require('winston-papertrail').Papertrail;

/**
 * [Logger description]
 * @param {[type]} options [description]
 * @param {[type]} config  {
 *   logLvl:3 //expects a number, if 0 it means everything is log, if 3, only CRITical errors are log
 *   logLineMaxSize:2 //line will be truncated if size superior
 * }
 *
 * DBG: junk (dev purpose)
 * INF: get info, trace routes
 * ERR: anormal path, portions of code which should never be reached
 * CRI: technical anormal behaviour (cant connect to db, etc)
 */
function Logger(options, config){
    this.path = options && options.path || __dirname+'/../../log/';
    this.path = path.normalize(this.path);
    this.link = this.path+'last';
    this.lvls = ['DBG', 'INF', 'ERR', 'CRI'].reduce(function(o,k,i){o[k]=i;return o;}, {});
    this.config = config;
    if(!config.hasOwnProperty('logLvl')){
        throw 'expect a logLvl in config';
    }
    this.binarySize = 0;
    this.stream = null;
    this.openStream({symlink:true},function(){});
    this.stack = [];
    this.winston = new Winston.Logger({
        transports: [
                new Winston.transports.Papertrail({
                        host: config.winston_host,
                        port: config.winston_port,
                        hostname: config.winston_hostname
                })
        ]
    });
    this.enableWinston = (typeof config.winston_enable == 'undefined') || config.winston_enable ;
}

Logger.prototype.write = function(s){
    var s = util.format.apply(console, arguments);
    this._log('INF', s);
}

Logger.prototype.dbg = function(){
    var s = util.format.apply(console, arguments);
    this._log('DBG', s);
};

Logger.prototype.inf = function(){
    var s = util.format.apply(console, arguments);
    this._log('INF', s);
};

Logger.prototype.err = function(){
    var s = util.format.apply(console, arguments);
    this._log('ERR', s);
};

Logger.prototype.cri = function(){
    var s = util.format.apply(console, arguments);
    this._log('CRI', s);
};


Logger.prototype.logDomain = function(){
    if(process.domain){
        return ['TRX:'+process.domain.id, 'USR:'+process.domain.ctx.userId||'nouser'];
    }
    return 'noctx';
};
function twoDigits(s){
    return ('0'+s).substr(-2);
}
Logger.prototype.format = function(lvl, s){
    var d = new Date();
    var date = twoDigits(d.getDate())+'/'+twoDigits(d.getMonth()+1)+'/'+(''+d.getFullYear()).substring(2);
    date += '_'+twoDigits(d.getHours())+':'+twoDigits(d.getMinutes())+':'+twoDigits(d.getSeconds());
    date += '.'+ ('00'+d.getMilliseconds()).substr(-3);
    var dom = this.logDomain();
    var head = '['+lvl+']'+[date].concat(dom).join('|');
    return head+'>'+s.substring(0, this.config.logLineMaxSize);
};


Logger.prototype.openStream = function(op, cbk){
    var that = this;
    return fs.lstat(that.link, function(err, stats){
        if(err){
            return that.createNewStream(op, cbk);
        }
        //if last exists, set the max binary size
        return fs.realpath(that.link, function(err, resolved){
                if(err){ //if last exists but references an unexisting file
                        return that.createNewStream(op, cbk);
                }
            return fs.lstat(resolved, function(err, stats){
                that.binarySize = stats.size;
                that.stream = fs.createWriteStream(that.link, {
                        flags: 'a',
                        encoding: null,
                        mode: 0666 
                });
                return cbk(null);
            });
        })
    });
}


/**
 * create a stream
 * remove old link
 * creates a link to the lastly created stream
 * @param {symlink:bool} if false, use the existing symlink or create one
 * @return {[type]} [description]
 */
Logger.prototype.createNewStream = function(options, cbk){
    if(this.stream){
        this.stream.end();
    }
    var that = this;

    var d = new Date();
    var date = (''+d.getFullYear()).substring(2)+'_'+twoDigits(d.getMonth()+1)+'_'+twoDigits(d.getDate());
    date += '_'+twoDigits(d.getHours())+twoDigits(d.getMinutes())+twoDigits(d.getSeconds());
    that.streamPath = path.normalize(that.path+'/'+date+'.fre');
    that.stream = fs.createWriteStream(that.streamPath, {
            flags: 'a',
            encoding: null,
            mode: 0666 
    });
    that.binarySize = 0;

    var createSymlink = function(err){
        if(err){
            console.error(err);
        }
        console.log('linking to : ', that.streamPath);
        fs.symlink(that.streamPath, that.link, cbk);//in case of concurrent access
    }
    if(!options.symlink){
        return fs.lstat(that.link, function(err, stats){
            if(err == null){
                return cbk();
            }
            return createSymlink(cbk);
        });
    }
    return fs.lstat(that.link, function(err, stats){
        if(err || stats.isSymbolicLink()){
            return fs.unlink(that.link, createSymlink);
        }
        return createSymlink();
    })
}
Logger.prototype._write = function(s){
    if(this.stream){return this.stream.write(s);}
    console.log(s);
}
Logger.prototype._log = function(lvl, s){
    if(this.lvls[lvl] >= this.config.logLvl){

        var str = this.format(lvl, s);
        if(this.enableWinston){
            if(lvl == 'CRI'){
                this.winston.error(s);
            }else if(lvl == 'ERR'){
                this.winston.warn(s);
            }else if(lvl == 'INF'){
                this.winston.info(s);
            }else{
                this.winston.debug(s);
            }
        }
        if(this.isLocked){
            console.log('stacking log ',str);
            return this.stack.push(str);
        }
        this.binarySize += str.length;

        if(this.config.logToConsole){
            console.log(str);
        }
        if(this.binarySize > this.config.logMaxFileSize){
            var that = this;
            that.isLocked = true; //put this here so no function call
            return this.createNewStream({symlink:true},function(){

                that._write('Stacked:|'+str+'\n');
                that.stack.forEach(function(s){
                    that._write('stacked:|'+s+'\n');  
                });
                that.stack = [];
                that.isLocked = false;
            });
        }
        this._write(str+'\n');
    }
};
module.exports = Logger;
