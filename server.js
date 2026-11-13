const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const app=express();const server=http.createServer(app);const io=new Server(server);const PORT=process.env.PORT||3000;
const spawns={patient:{x:-18,y:25,z:7,floor:3},medic:{x:-25,y:17,z:-5,floor:2},orderly:{x:25,y:17,z:-5,floor:2},director:{x:23,y:9,z:8,floor:1}};
const inventories={patient:['glassShard'],medic:['smallMedicalKit','mediumMedicalKit'],orderly:['riotShield','taser','stunBaton','arrestCuffs'],director:['stunBaton','ignotusShield','tablet']};
const colors={patient:'#ef4444',medic:'#34d399',orderly:'#fbbf24',director:'#a78bfa'};const players=new Map();
app.use(express.static(path.join(__dirname,'public')));app.get('/health',(_req,res)=>res.json({ok:true,players:players.size}));
function publish(){io.emit('playersState',[...players.values()]);}
io.on('connection',socket=>{
 socket.on('joinGame',(p={})=>{const role=Object.hasOwn(spawns,p.role)?p.role:'patient',inventory=[...inventories[role]],spawn=spawns[role];const player={id:socket.id,name:String(p.name||'Player').slice(0,20),role,...spawn,color:colors[role],inventory,equippedItem:inventory[0]||null,stunned:false,health:100};players.set(socket.id,player);socket.emit('assignedPlayer',player);publish();});
 socket.on('equipItem',({item}={})=>{const player=players.get(socket.id);if(!player||typeof item!=='string'||!player.inventory.includes(item))return;player.equippedItem=item;publish();});
 socket.on('updatePlayer',(p={})=>{const player=players.get(socket.id);if(!player)return;for(const key of ['x','y','z']){const n=Number(p[key]);if(Number.isFinite(n))player[key]=Math.max(-100,Math.min(100,n));}const floor=Number(p.floor);if(Number.isInteger(floor)&&floor>=0&&floor<=3)player.floor=floor;if(p.stunned!==undefined)player.stunned=Boolean(p.stunned);if(p.health!==undefined&&Number.isFinite(Number(p.health)))player.health=Math.max(0,Math.min(100,Number(p.health)));publish();});
 socket.on('useAbility',({ability}={})=>{const p=players.get(socket.id);if(p)socket.emit('abilityFeedback',{ok:true,ability:String(ability||'').slice(0,40),message:`${p.role} used ${String(ability||'ability').slice(0,40)}.`});});
 socket.on('disconnect',()=>{players.delete(socket.id);publish();});
});
server.listen(PORT,()=>console.log(`Asylum server running on port ${PORT}`));
