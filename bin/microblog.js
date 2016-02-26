#!/usr/bin/env node
// jshint esversion: 6
// jshint asi: true

"use strict"

const http = require("http")
const path = require("path")
const url = require("url")
const fs = require("fs")
const dot = require("dot")

const mime_types = {
	".html": "text/html",
	".htm": "text/html",
	".css": "text/css",
	".xml": "text/xml",
	".txt": "text/plain",

	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".ico": "image/x-icon",
	".bmp": "image/x-ms-bmp",
	".svg": "image/svg+xml",
	".svgz": "image/svg+xml",
	".webp": "image/webp",

	".js": "application/javascript",
	".atom": "application/atom+xml",
	".rss": "application/rss+xml",
	".json": "application/json",
	".woff": "application/font-woff",
	".jar": "application/java-archive",
	".war": "applicaiton/java-archive",
	".ear": "applicaiton/java-archive",
	".doc": "application/msword",
	".pdf": "application/pdf",
	".rtf": "application/rtf",
	".xls": "application/vnd.ms-excel",
	".ppt": "application/vnd.ms-powerpoint",
	".xhtml": "application/xhtml+xml",
	".7z": "application/x-7z-compressed",
	".zip": "application/zip",
	".rar": "application/x-rar-compressed",

	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".oga": "audio/ogg",
	".m4a": "audio/x-m4a",
	".aac": "audio/x-m4a",

	".webm": "video/webm",
	".mp4": "video/mp4",
	".mkv": "video/x-matroska",
	".flv": "video/x-flv",
	".avi": "video/x-msvideo",
	".mpg": "video/mpeg",
	".mpeg": "video/mpeg",
	".wmv": "video/x-ms-wmv",
	".mov": "video/quicktime",
	".3gp": "video/3gpp",
	".3gpp": "video/3gpp",
}
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const RECORD_SEPARATOR = "\u001D"
const UNIT_SEPARATOR = "\u001F"

function HTMLEscape (str) {
	return str
		.replace("&", "&amp;")
		.replace("<", "&lt;")
		.replace(">", "&gt;")
}

function determine_mime_type (path) {
	const index = path.slice(path.lastIndexOf("."))
	const mime = mime_types[index]
	if (mime !== undefined) return mime
	else return "application/octet_stream"
}

function val_in_array (val, arr) {
	for (let i = 0, len = arr.length; i < len; i++)
		if (arr[i] === val) return true
	return false
}

function ResponseConf (code, headers, data) {
	this.code = code
	this.headers = headers
	this.data = data
}

class View {
	constructor (templatepath, host, blog) {
		this.templates = dot.process({path: templatepath})
		this.host = host
		this.blog = blog
	}

	ok_index_html (posts, query) {
		return new ResponseConf (
			200,
			{"Content-Type": "text/html"},
			this.templates.index({
				blog: this.blog,
				tag: query.tag,
				posts: posts
			})
		)
	}

	ok_index_json (posts) {
		const data = []
		for (let i = 0, len = posts.length; i < len; i++)
			data.push({
				time: posts[i].sane_date(),
				content: posts[i].content,
				index: posts[i].index,
			})
		return new ResponseConf (
			200,
			{"Content-Type": "application/json"},
			JSON.stringify({data})
		)
	}
}

class Post {
	constructor (text) {
		const fields = text.split(UNIT_SEPARATOR)
		this.time = new Date(parseInt(fields[0], 10))
		this.tags = []
		this.content = HTMLEscape(fields[1])
		.replace(new RegExp("https?://[^ ]+"), (str) => {
			return `<a href=${str}>${str}</a>`
		})
		.replace(/ #([^ ]+)/g, (str, tagname) => {
			this.tags.push(tagname)
			return ` <a href="/index?tag=${encodeURIComponent(tagname)}">${str}</a>`
		})
	}

	has_tag (tag) {
		return val_in_array(tag, this.tags)
	}

	sane_date() {
		return `${this.time.getDate()} ${months[this.time.getMonth()]} ${this.time.getFullYear()}`
	}
}

class Model {
	constructor (pathname) {
		this.pathname = pathname
		let lines
		try {
			lines = fs.readFileSync(pathname, "utf8").split(RECORD_SEPARATOR)
		} catch (e) {
			if (e.code === "ENOENT") lines = []
			else throw e
		}
		this.posts = []
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].length === 0) continue
			const post = new Post(lines[i])
			post.index = i
			this.posts.push(post)
		}
		this.length = this.posts.length
	}

	get (postid) {
		return this.posts[postid]
	}

	query (q, callback) {
		let i = this.length - 1
		let step = -1
		let counter = 20
		let results = []
		if (q.older) {
			let tmp = parseInt(q.older, 10)
			if (Number.isInteger(tmp)) i = tmp - 1
		} else if (q.newer) {
			let tmp = parseInt(q.newer, 10)
			if (Number.isInteger(tmp)) {
				i = tmp
				step = 1
			}
		}
		if (q.tag) {
			for (; i >= 0 && i < this.length && counter > 0; i += step) {
				if (this.posts[i].has_tag(q.tag)) {
					results.push(this.posts[i])
					counter--
				}
			}
		} else {
			for (; i >= 0 && i < this.length && counter > 0; i += step) {
				results.push(this.posts[i])
				counter--
			}
		}
		callback(results)
	}

	post (txt) {
		var d = Date.now()
		txt = d + UNIT_SEPARATOR + txt
		fs.appendFileSync(this.pathname, txt + RECORD_SEPARATOR, "utf8")
		const post = new Post(txt)
		post.index = this.length
		this.posts.push(post)
		this.length++
	}
}

class Controller {
	constructor (model, view, port, host, password) {
		this.model = model
		this.view = view
		this.password = password
		this.server = http.createServer(this.request_listener.bind(this))
		this.server.listen(port, host)
		this.functions = this.init_router() 
	}

	init_router () {
		return {
			"/": {
				"GET": this.GET_index.bind(this),
				"POST": this.POST_index.bind(this),
			},
			"/index": {
				"GET": this.GET_index.bind(this),
				"POST": this.POST_index.bind(this),
			},
			"/static": {
				"GET": this.GET_static.bind(this),
				"POST": this.POST_static.bind(this),
			},
			/*
			"/post": {
				"GET": this.GET_post.bind(this),
			},
			*/
			"/rss": {
				"GET": this.GET_rss.bind(this),
			},
		}
	}

	request_listener (req, res) {
		req.url = url.parse(req.url, true)
		const endpoint = this.functions[req.url.pathname]
		if (endpoint !== undefined) {
			const fn = endpoint[req.method]
			if (fn !== undefined) {
				fn(req, res)
			} else {
				this.serve(res, {code: 405, data: "405"})
			}
		} else {
			this.serve(res, {code: 404, data: "404"})
		}
	}

	serve (res, conf) {
		res.writeHead(conf.code, conf.headers)
		if (conf.data.constructor === fs.ReadStream) conf.data.pipe(res)
		else res.end(conf.data)
	}

	authorised (req) {
		if (req.url.query.password === this.password) return true
		else return false
	}

	extract_contents (req, callback) {
		let str = ""
		req.on("data", (chunk) => {
			str += chunk
		})
		req.on("end", () => {
			callback(null, str)
		})
	}

	GET_index (req, res) {
		this.model.query(req.url.query, (results) => {
			if (results.length === 0)
				this.serve(res, {code: 404, data: "404"})
			else if (req.headers["x-requested-with"] === "XMLHttpRequest")
				this.serve(res, this.view.ok_index_json(results))
			else
				this.serve(res, this.view.ok_index_html(results, req.url.query))
		})
	}

	POST_index (req, res) {
		if (!this.authorised(req)) return this.serve(res, {code: 403, data: "403"})
		this.extract_contents(req, (err, contents) => {
			if (err) return this.serve(res, {code: 500, data: "500"})
			contents = contents.trim()
			if (contents.length === 0) return this.serve(res, {code: 400, data: "400"})
			this.model.post(contents)
			this.serve(res, {code:200, data: "200"})
		})
	}

	/*
	GET_post (req, res) {
		if (!req.url.query.id) return this.serve(res, {code: 400, data: "404"})
		let i = parseInt(req.url.query.id, 10)
		if (!Number.isInteger(i)) return this.serve(res, {code: 400, data: "404"})
		const post = this.model.get(req.url.query.id)
		if (!post) return this.serve(res, {code: 404, data: "404"})
		else return this.serve(res, {code: 200, data: this.view.post(post)})
	}
	*/

	GET_static (req, res) {
		const handle = (e) => {
			}
		const filename = req.url.query.name
		if (!filename) return this.serve(res, {code: 400, data: "400"})
		const stream = fs.createReadStream(path.join("./static", filename))
		stream.on("error", (e) => {
			if (e.code === "ENOENT") return this.serve(res, {code: 404, data: "404"})
			else return this.serve(res, {code: 404, data: ""+e})
		})
		this.serve(res, {code: 200, headers: {"Content-Type": determine_mime_type(filename)}, data: stream})
	}

	POST_static (req, res) {
		if (!this.authorised(req)) return this.serve(res, {code:403, data: "403"})
		let pathname
		if (req.url.query.name) {
			pathname = path.join("./static", req.url.query.name)
		} else {
			return this.serve(res, {code: 400, data: "400"})
		}
		let stream
		try {
			stream = fs.createWriteStream(pathname, {
				flags: "wx",
				defaultEncoding: "binary",
				mode: 0o640
			})
		} catch (e) {
			return this.serve(res, {code: 404, data: ""+e})
		}
		req.on("end", () => {
			return this.serve(res, {code: 200, headers: {"Content-Type": "text/plain"}, data: pathname})
		})
		req.pipe(stream)
	}

	GET_rss (req, res) {		
		this.model.query({}, (results) => {
			//this.serve(res, {code: 200, data: this.view.index(results, req.url.query)})
		})
	}
}

function configure () {
	return {
		http: {
			port: process.env.HTTP_PORT || 50000,
			host: process.env.HTTP_HOST || "localhost",
		},
		blog: {
			title: process.env.BLOG_TITLE || "Microblog",
			author: process.env.BLOG_AUTHOR || "Someone",
			description: process.env.BLOG_DESCRIPTION || "A very plain twitter style microblog",
			keywords: process.env.BLOG_KEYWORDS || "microblog, micro, blog",

		},
		password: process.env.PASSWORD || "password",
	}
}

function main() {
	const conf = configure()
	const controller = new Controller(
		new Model("./entries.txt"),
		new View("./templates", conf.http.host, conf.blog),
		conf.http.port,
		conf.http.host,
		conf.password
	)
	console.log(`Server listening at ${conf.http.host}:${conf.http.port}`)
}

main()
