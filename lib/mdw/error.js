function end(config = {}){
    return function(e, req,res, next){
        config.logger && config.logger.inf(e);
        var code = e.statusCode || parseInt(e.code);
        if(code >= 100 && code < 600){
            res.status(e.statusCode||e.code).json(e);
            return Promise.resolve();
        }
        res.status(500).send(e.toString());
        return Promise.resolve();
    }
}
module.exports = {
    end:end
}