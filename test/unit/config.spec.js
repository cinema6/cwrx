var path      = require('path'),
    fs        = require('fs-extra'),
    config    = require('../../lib/config');

describe('config', function() {
    var rmList = [];
    afterEach(function(){
        rmList.forEach(function(removable){
            if (fs.existsSync(removable)){
                fs.removeSync(removable);
            }
        });
    });
    
    describe('createConfiguration', function() {
        var defaultCfg = {
            caches : {
                run     : path.normalize('/usr/local/share/cwrx/dub/caches/run/'),
                line    : path.normalize('/usr/local/share/cwrx/dub/caches/line/'),
                blanks  : path.normalize('/usr/local/share/cwrx/dub/caches/blanks/'),
                script  : path.normalize('/usr/local/share/cwrx/dub/caches/script/'),
                video   : path.normalize('/usr/local/share/cwrx/dub/caches/video/'),
                output  : path.normalize('/usr/local/share/cwrx/dub/caches/output/')
            }
        };
        
        it('should create a configuration object without a config file',function(){
            var cfg = config.createConfigObject('', defaultCfg);
            
            expect(cfg.caches).toBeDefined();
            expect(cfg.caches.run).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/run/'));
            expect(cfg.caches.line).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/line/'));
            expect(cfg.caches.blanks).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/blanks/'));
            expect(cfg.caches.script).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/script/'));
            expect(cfg.caches.video).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/video/'));
            expect(cfg.caches.output).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/output/'));
        });
            
        it('should throw an error if given a non existant configuration file', function(){
            expect(function(){
                config.createConfigObject('abc.cfg', defaultCfg);
            }).toThrow('ENOENT, no such file or directory \'abc.cfg\'');
        });

        it('should throw an error if given a badly formed configuration file', function(){
            rmList.push(path.join(__dirname,'tmpcfg.json'));
            fs.writeFileSync(path.join(__dirname,'tmpcfg.json'),'abc');
            expect(function(){
                config.createConfigObject(path.join(__dirname,'tmpcfg.json'), defaultCfg);
            }).toThrow('Unexpected token a');
        });
    });
});