var requestAnimationFrame = window.requestAnimationFrame ||
window.mozRequestAnimationFrame ||
window.webkitRequestAnimationFrame ||
window.msRequestAnimationFrame ||
function (callback) { setTimeout(callback, 1000 / 30); };

var canvas = document.getElementById("digital-twins-demo");
canvas.width = 800;
canvas.height = 600;
canvas.style.opacity = 1;
var context = canvas.getContext("2d");

var hostImage = new Image();
hostImage.src = "./images/animation/host.png";

var esxiImage = new Image();
esxiImage.src = "./images/animation/esxi.png";

var appOsImage = new Image();
appOsImage.src = "./images/animation/app-os.png";

var vsphereImage = new Image();
vsphereImage.src = "./images/animation/vmware_vsphere.png";

var vcAvailability = new Image();
vcAvailability.src = "./images/animation/availability.png";

var vcUpdate = new Image();
vcUpdate.src = "./images/animation/upgrade.png";

var vcBackup = new Image();
vcBackup.src = "./images/animation/backup.png";

var vcAppliance = new Image();
vcAppliance.src = "./images/animation/appliance.png";

var vcFeaturesImages = [vcAvailability, vcUpdate, vcBackup, vcAppliance];

var layers = {
    hostLayer: {
        isVisible: true,
        hosts: [
            {
                isVisible: true,
                vms: 3,
                hasEsxiInstalled: true,
            },
            {
                isVisible: true,
                vms: 3,
                hasEsxiInstalled: false,
            },
            {
                isVisible: true,
                vms: 3,
                hasEsxiInstalled: false,
            }]
    },
    hypervisorLayer: {
        isVisible: true,
    }
};

var options = {
    'Брой хостове': 1,
    'ESXi инсталация': false,
    'Виртуални маш.': 0,
    'vSphere': false
};

var gui = new dat.gui.GUI({ name: "Настройки", autoPlace: false });
gui.add(options, 'Брой хостове').min(1).max(4).step(1);
gui.add(options, 'ESXi инсталация');
gui.add(options, 'Виртуални маш.').min(0).max(3).step(1);
gui.add(options, 'vSphere');

var customContainer = document.getElementById('gui-container');
customContainer.appendChild(gui.domElement);

var mouseCoordinates, bubble, drawStartY = 500;

var Collision = function () {
    return {
      Rectangle: function(object1, object2) {
          if (!object1 || !object2) {
            return false;
          }
          if (object1.x + object1.width > object2.x &&
              object1.x < object2.x + object2.width &&
              object1.y + object1.height > object2.y &&
              object1.y < object2.y + object2.height) {
              return true;
          }
          
          return false;
      }  
    };
}();

document.onmousemove = handleMouseMove;
function handleMouseMove(event) {
    event = event || window.event; // IE-ism
    //var rect = canvas.getBoundingClientRect();

    let mouseX = event.clientX - Math.abs(canvas.offsetLeft - document.body.scrollLeft);
    let mouseY = event.clientY - Math.abs(canvas.offsetTop - document.body.scrollTop);

    mouseCoordinates = {
        x: mouseX - 310,
        y: mouseY - 266,
        width: 5,
        height: 5
    };
}

function update() {
    drawStartY = 500;
    layers.hostLayer.isVisible = true;
    layers.hostLayer.hosts = [];
    for (var index = 0; index < options['Брой хостове']; index++) {
        layers.hostLayer.hosts.push({
            isVisible: true,
            vms: options['ESXi инсталация'] ? options['Виртуални маш.'] : 0,
            hasEsxiInstalled: options['ESXi инсталация'],
        });
    }
    layers.hypervisorLayer.isVisible = options['vSphere'];

    if (!options['ESXi инсталация'] || !options['vSphere']) {
        drawStartY -= 250;
    }

    if (options['Виртуални маш.'] <= 0) {
        drawStartY -= 50;
    }

    if (Collision.Rectangle(mouseCoordinates, layers.hypervisorLayer)) {
        bubble = {
            x: 300,
            y: 300,
            text: "Test text"
        };
    }

    setTimeout(update, 10);
}

function drawHostsLayer(context) {
    var hasVms = false;
    if (layers.hostLayer.isVisible) {
        var hosts = layers.hostLayer.hosts.filter(h => h.isVisible);
        var hostWidth = 100, hostHeight = 100;
        var margin = ((canvas.width / hosts.length) - hostWidth) / 2;

        var x = 0, y = drawStartY;
        for (var host of hosts) {
            x += margin;
            // Fix image rendering
            context.drawImage(hostImage, x, y, hostWidth, hostHeight);

            if (host.hasEsxiInstalled) {
                context.drawImage(esxiImage, x, y, hostWidth + 30, hostHeight);
            }

            host.x = x;
            host.y = y;
            host.width = hostWidth;
            host.height = hostHeight;
            x += hostWidth + margin;

            for (var vmCount = 0; vmCount < host.vms; vmCount ++) {
                hasVms = true;
                var vmX = host.x + (50 * vmCount), vmY = host.y - 50, vmWidth = 45, vmHeight = 45;

                context.strokeStyle = "#78d2ff";
                context.beginPath();
                context.moveTo(host.x + host.width / 2, host.y);
                context.lineTo(vmX, vmY);
                context.stroke();

                context.drawImage(appOsImage, vmX - vmWidth / 2, vmY - vmHeight / 2, vmWidth, vmHeight);
            }
        }
    }

    return hasVms ? 50 : 0;
}

function drawHypervisorLayer(context, vmsOffset) {
    if (layers.hypervisorLayer.isVisible) {
        var hosts = layers.hostLayer.hosts;
        if (hosts.length <= 1 || !hosts.some(h => h.hasEsxiInstalled)) {
            return;
        }

        var first = hosts[0], last = hosts[hosts.length - 1];
        var margin = 30 + vmsOffset, triangleHeight = 100;

        // the triangle
        context.lineWidth = "4";
        context.beginPath();
        context.moveTo(first.x, first.y - margin);
        var triangleTopX = first.x + ((last.x + last.width) - first.x) / 2,
            triangleTopY = first.y - vmsOffset - triangleHeight;
        context.lineTo(triangleTopX, triangleTopY);
        context.lineTo(last.x + last.width, last.y - margin);
        context.closePath();

        // the fill color
        context.fillStyle = "#78d2ff";
        context.fill();

        var hypervisorServiceWidth = 300, hypervisorServiceHeight = 100;
        var hypervisorServiceX = triangleTopX - hypervisorServiceWidth / 2,
            hypervisorServiceY = triangleTopY - (hypervisorServiceHeight + 30);
        context.drawImage(vsphereImage, hypervisorServiceX, hypervisorServiceY, hypervisorServiceWidth, hypervisorServiceHeight);
        
        layers.hypervisorLayer.x = hypervisorServiceX;
        layers.hypervisorLayer.x = hypervisorServiceY;
        layers.hypervisorLayer.width = hypervisorServiceWidth;
        layers.hypervisorLayer.height = hypervisorServiceHeight;

        var vcFeatureWidth = 100, vcFeatureHeight = 100;
        margin = (canvas.width / vcFeaturesImages.length - vcFeatureWidth) / 2;
        var x = margin, y = hypervisorServiceY - vcFeatureHeight - 100;

        for (var index = 0; index < vcFeaturesImages.length; index ++) {
            context.strokeStyle = "yellow";
            context.beginPath();
            context.moveTo(hypervisorServiceX + hypervisorServiceWidth / 2, hypervisorServiceY);
            context.lineTo(x + margin + vcFeatureWidth / 2, vcFeatureHeight);
            context.stroke();

            context.drawImage(vcFeaturesImages[index], x + margin, y, vcFeatureWidth, vcFeatureHeight);
            x += margin + vcFeatureWidth;
        }
    }
}

function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = 1;

    // Draw hosts
    var vmsOffset = drawHostsLayer(context);
    // Draw hypervisor
    drawHypervisorLayer(context, vmsOffset);

    // Draw bubble
    if (bubble) {
        drawBubble(context, bubble.text, bubble.x, bubble.y, 200, 100, 20);
    }

    requestAnimationFrame(draw);
}

function drawBubble(ctx, text, x, y, w, h, radius)
{
  var r = x + w;
  var b = y + h;
  ctx.beginPath();
  ctx.fillStyle="white";
  ctx.lineWidth="2";
  ctx.moveTo(x+radius, y);
  ctx.lineTo(x+radius/2, y-10);
  ctx.lineTo(x+radius * 2, y);
  ctx.lineTo(r-radius, y);
  ctx.quadraticCurveTo(r, y, r, y+radius);
  ctx.lineTo(r, y+h-radius);
  ctx.quadraticCurveTo(r, b, r-radius, b);
  ctx.lineTo(x+radius, b);
  ctx.quadraticCurveTo(x, b, x, b-radius);
  ctx.lineTo(x, y+radius);
  ctx.quadraticCurveTo(x, y, x+radius, y);
  ctx.fill();

  ctx.fillStyle="black";
  ctx.font = "15px Arial";
  var lineheight = 15;
  var lines = text.split('\n');

  for (var i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + 10, y + 20 + (i * lineheight) );
  }
}

update();
draw();