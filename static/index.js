function main () {
	"use strict"
	var might_have_older = true

	function scroll_check (ev) {
		if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight && might_have_older) {
			check_older_entries()
		}
	}

	function check_older_entries() {
		var index = document.querySelector("article:last-of-type").id
		console.log(index)
		var req = new XMLHttpRequest()
		req.onload = response_listener 
		req.open("GET", "/?older=" + index, true)
		req.setRequestHeader("x-requested-with", "XMLHttpRequest")
		req.send()
	}

	function response_listener (e) {
		if (this.status === 404)
			might_have_older = false
		else if (this.status === 200)
			append_results(this.response)
	}

	function append_results (txt) {
		var obj = JSON.parse(txt)
		var main = document.querySelector("main")
		for (var i = 0, len = obj.data.length; i < len; i++)
			main.appendChild(render_article(obj.data[i]))
	}

	function render_article (data) {
		var article = document.createElement("article")
		var datespan = document.createElement("span")
		var contentspan = document.createElement("span")
		datespan.className = "date"
		contentspan.className = "content"
		datespan.appendChild(document.createTextNode(data.time))
		contentspan.appendChild(document.createTextNode(data.content))
		article.id = data.index
		article.appendChild(datespan)
		article.appendChild(contentspan)
		return article
	}

	window.onscroll = scroll_check
}

window.onload = main
