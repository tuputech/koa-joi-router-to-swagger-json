'use strict';

const _ = require('lodash');


const SwaggerAPI = require('./lib/api');
exports.SwaggerAPI = SwaggerAPI








/**
 * 1 克隆一份 router 配置，避免影响服务端 app.use(router)，只影响 SwaggerAPI 生成
 * 2 将全部 validate.multipart 合并到 validate.query，让 SwaggerAPI 将参数生成到 post.parameters，方便后续修改
 * @param {*} router
 */
function parseJoiRouter(router) {
    const _router = _.cloneDeep(router)
    const routes = _router.routes

    _router.routes = []
    routes.forEach(route => {
        if (!route.meta || !route.meta.swagger || !route.meta.swagger.tags || route.meta.swagger.tags.length === 0)
            return
        if (route.validate.multipart) {
            route.validate.query = Object.assign({}, route.validate.query, route.validate.multipart)
        }
        _router.routes.push(route)
    })
    return _router
}



/**
 * 对 SwaggerAPI 生成的结果进行修改，使得 Swagger UI 能够正常支持 form 参数
 * 1 将 route.validate.multipart 全部字段都改为 param.in ="formData"
 * 2 将 joi 配置的 meta 信息 assign 过来
 * 3 根据 meta 判断，如果是 swaggerType = file 的，加上 param.type = "file"
 * @param {*} _router
 * @param {*} spec
 */
function modifyMultipartSwaggerJSON(_router, spec) {
    _router.routes.map(route => {
        if (!route.validate.multipart) {
            return
        }
        const specParams = spec.paths[route.path].post.parameters

        for (let key in route.validate.multipart) {

            specParams.every(param => {
                if (param.name === key) {

                    param.in ="formData"

                    const _meta = route.validate.multipart[key]._meta
                    if (_meta && _meta.length) {
                        _meta.map(m => {
                            param["x-meta"] = Object.assign({}, param["x-meta"], m)
                        })
                    }

                    if (param['x-meta'] && param['x-meta'].swaggerType === 'file') {
                        param.type = 'file'
                    }
                    return false
                }
                return true
            })
        }
    })
}





function genDocJson(koaRouter, options = {}) {
    // 修改自动生成的 swagger json，实现 swagger UI 对 文件上传到支持
    // 1、route.validate.type === 'multipart'  # 设置content-type【koa-joi-router 本身支持的】
    // 2、route.validate.multipart # 将要form表单字段放这里【koa-joi-router 本身不支持的】
    // 3、faceFile: Joi.any().meta({ swaggerType: 'file' }) # 文件字段设置 any类型和meta信息
    // 4、multipartToQuery(router) # 详见函数说明
    // 5、modifyMultipartSwaggerJSON(_router, spec) # 详见函数说明

    const _router = parseJoiRouter(koaRouter)

    const swagger = new SwaggerAPI()
    swagger.addJoiRouter(_router)
    const spec = swagger.generateSpec(
        {
            info: _.cloneDeep(options.info),
            basePath: options.basePath || '/',
        },
        {
            defaultResponses: {} // Custom default responses if you don't like default 200
        }
    )

    modifyMultipartSwaggerJSON(_router, spec)

    return JSON.stringify(spec, null, ' ')
}



function getRoutes(koaRouter, options) {
    const swaggerJSON = genDocJson(koaRouter, options)
    return [
        {
            method: 'GET',
            path: options.jsonPath || '/swagger.json',
            handler(ctx) {
                ctx.body = swaggerJSON
            },
        },
    ]
}

exports.route = getRoutes


exports.middlewares = function(koaRouter, options, jsonRoute = false) {
    const getSwaggerJSON = (opt = options) => {
        return genDocJson(koaRouter, opt)
    }

    const swaggerJSON = genDocJson(koaRouter, options)

    const middleware = async (ctx, next) => {
        ctx.getSwaggerJSON = getSwaggerJSON
        ctx.swaggerJSON = swaggerJSON
        await next()
    }
    if (!jsonRoute) return [ middleware ]

    const routes = getRoutes(koaRouter, options)
    koaRouter.route(routes)
    return [ middleware, koaRouter.middleware(), ]
}


