import * as path from 'path';
import * as fs from 'fs';
import * as process from 'process';
import * as babylon from "babylon";
import traverse from "@babel/traverse";
import generator from "@babel/generator";
import * as t from '@babel/types';
import { SyncHook } from 'tapable';
interface Config {
    entry: string,
    mode: "development" | "production",
    output: {
        filename: string,
        path: string
    },
    module?: {
        rules: Array<{test: RegExp, use: Array<string>}>
    },
    plugins?: Array<any>
}
type Modules = {[k in string]: string}

class Minipack {
    root: string = process.cwd();
    entry: string = this.config.entry;
    modules: Modules = {};
    hooks = {
        beforeStart: new SyncHook(["beforeStart"]),
        compile: new SyncHook(["compile"]),
        emit: new SyncHook(["emit"])
    }
    constructor(public config: Config) {
        this.config = config;
        let plugins = this.config.plugins || [];
        plugins.forEach(p => p.apply(this))
    }
    static CURRENT: Readonly<string> = "./";

    getSourceCode(path: string): string {
        let code = fs.readFileSync(path, 'utf8');
        code = this.load(path, code);
        return code;
    }

    parseCode(code: string, parentPath: string): {code: string, deps: Array<string>}{
        const ast = babylon.parse(code)as any as t.Node;
        let deps: Array<string> = [];
        traverse(ast , {
            CallExpression(p) {
                let node = p.node as any;
                if (node.callee .name === 'require') {
                    node.callee.name = "__webpack_require__";
                    const currentName = node.arguments[0].value;
                    let name = `${Minipack.CURRENT}${path.join(parentPath, currentName)}`;
                    deps.push(name)
                    node.arguments = [t.stringLiteral(currentName)];
                }
            }
        })
        const finalCode = generator(ast);
        return { code: finalCode.code, deps}
    }

    build(filePath: string, isEntry = false ): Modules {
        const code = this.getSourceCode(path.resolve(this.root, filePath));
        let moduleName = Minipack.CURRENT + path.relative(this.root, filePath);
        isEntry && (this.entry = moduleName);
        this.hooks.compile.call("compile")
        const {code: sourceCode, deps = []} = this.parseCode(code, path.dirname(filePath));
        this.modules[moduleName] = sourceCode;
        deps.forEach(dep => {
            this.build(dep);
        })
        return this.modules;
    }

    start() {

        const module = this.build(this.config.entry, true);
        console.log(module)
    }

    load(p: string, code: string) {
        let rules = this.config.module?.rules;
        if (!rules?.length) return code;
        rules.forEach(rule => {
            const {test, use } = rule;
            if (test.test(p)) {
                let loaderLen = 0;
                while(loaderLen <= use.length) {
                    let loader = require(use[loaderLen++]);
                    code = loader(code);
                }

            }
        })
        return code
    }
}

const m = new Minipack({
    mode: "development",
    entry: "./test.js",
    output: {
        filename: "bundle.js",
        path: path.resolve(__dirname, "dist")
    }
});
m.hooks.beforeStart.call("beforeStart")
m.start();
