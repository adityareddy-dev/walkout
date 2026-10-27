var out = document.getElementById("out");
var spin = document.getElementById("spin");
var deg = 0;
setInterval(function () { deg = (deg + 30) % 360; spin.style.transform = "rotate(" + deg + "deg)"; }, 100);
document.getElementById("works").addEventListener("click", function () {
  var li = document.createElement("li");
  li.textContent = "added";
  out.appendChild(li);
});
document.getElementById("slow").addEventListener("click", function blockFor400() {
  var end = performance.now() + 400;
  while (performance.now() < end) {}
  var li = document.createElement("li");
  li.textContent = "slow done";
  out.appendChild(li);
});
document.getElementById("net").addEventListener("click", function () {
  fetch("data.json").then(function (r) { return r.json(); }).then(function () {});
});
document.getElementById("boom").addEventListener("click", function () {
  null.explode();
});
