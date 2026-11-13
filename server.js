const express=require('express');
const http=require('http');
const path=require('path');
const {Server}=require('socket.io');
const app=express(),server=http.createServer(app),io=new Server(server),PORT=process.env.PORT||3000;
const spawns={patient:{x:-52,y:28,z:20,floor:3},medic:{x:-68,y:19,z:-20,floor:2},orderly:{x:68,y:19,z:-20,floor:2},director:{x:54,y:10,z:20,floor:1}};
const inventories={patient:['glassShard'],medic:['smallMedicalKit','mediumMedicalKit'],orderly:['riotShield','taser','stunBaton','arrestCuffs'],director:['stunBaton','ignotusShield','tablet']};
const maxHealth={patient:100,medic:100,orderly:115,director:100};
const colors={patient:'#ef4444',medic:'#34d399',orderly:'#fbbf24',director:'#a78bfa'},players=new Map();
app.use(express.static(path.join(__dirname,'public')));app.get('/health',(_req,res)=>res.json({ok:true,players:players.size}));
const publish=()=>io.emit('playersState',[...players.values()]);
io.on('connection',socket=>{
 socket.on('joinGame',(p={})=>{const role=Object.hasOwn(spawns,p.role)?p.role:'patient',inventory=[...inventories[role]],spawn=spawns[role];const player={id:socket.id,name:String(p.name||'Player').slice(0,20),role,...spawn,color:colors[role],inventory,equippedItem:inventory[0]||null,maxHealth:maxHealth[role],health:maxHealth[role],stunned:false};players.set(socket.id,player);socket.emit('assignedPlayer',player);publish();});
 socket.on('equipItem',({item}={})=>{const p=players.get(socket.id);if(!p||typeof item!=='string'||!p.inventory.includes(item))return;p.equippedItem=item;publish();});
 socket.on('updatePlayer',(data={})=>{const p=players.get(socket.id);if(!p)return;for(const key of ['x','y','z']){const n=Number(data[key]);if(Number.isFinite(n))p[key]=Math.max(-200,Math.min(200,n));}const floor=Number(data.floor);if(Number.isInteger(floor)&&floor>=0&&floor<=3)p.floor=floor;if(data.stunned!==undefined)p.stunned=Boolean(data.stunned);if(data.health!==undefined&&Number.isFinite(Number(data.health)))p.health=Math.max(0,Math.min(p.maxHealth,Number(data.health)));publish();});
 socket.on('useAbility',({ability}={})=>{const p=players.get(socket.id);if(p)socket.emit('abilityFeedback',{ok:true,ability:String(ability||'').slice(0,40),message:`${p.role} used ${String(ability||'ability').slice(0,40)}.`});});
 socket.on('disconnect',()=>{players.delete(socket.id);publish();});
});
server.listen(PORT,()=>console.log(`Asylum server running on port ${PORT}`));
