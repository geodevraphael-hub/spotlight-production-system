// Separate nearby screen markers so every asset remains individually visible;
// callers retain the original coordinates for links, details and leader lines.
export function separateMapPoints(points,threshold=26){
 const clusters=[];
 for(let index=0;index<points.length;index++){
  const point=points[index];let best=null,bestDistance=threshold;
  for(const cluster of clusters){const distance=Math.hypot(point.x-cluster.x,point.y-cluster.y);if(distance<bestDistance){best=cluster;bestDistance=distance;}}
  if(!best)clusters.push({x:point.x,y:point.y,items:[index]});else{best.items.push(index);best.x=best.items.reduce((sum,i)=>sum+points[i].x,0)/best.items.length;best.y=best.items.reduce((sum,i)=>sum+points[i].y,0)/best.items.length;}
 }
 const separated=Array(points.length);
 for(const cluster of clusters){const count=cluster.items.length,radius=count===1?0:Math.min(160,Math.max(18,count*5));cluster.items.forEach((index,position)=>{const angle=-Math.PI/2+(Math.PI*2*position/count);separated[index]={x:cluster.x+Math.cos(angle)*radius,y:cluster.y+Math.sin(angle)*radius,sourceX:points[index].x,sourceY:points[index].y,clusterSize:count};});}
 return separated;
}
