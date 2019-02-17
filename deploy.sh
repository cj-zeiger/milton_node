pkill -f app_old.js
cd ~/milton_node
npm install
rm nohup.out
nohup npm run dev &
