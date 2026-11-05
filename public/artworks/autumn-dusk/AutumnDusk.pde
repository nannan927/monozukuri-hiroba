// 秋の余白 / Autumn Dusk — Processing 4 / Java mode
// 追加ライブラリ不要。音声解析ではなく、86 BPMの内部時計で静かに呼吸します。
// Space: pause  R: restart  N: new composition  S: save PNG  H: help
// ↑↓: time speed (1x normally, 4x to watch a leaf's life quickly)
final float BPM = 86;
final float SONG_SECONDS = 44 * 4 * 60.0f / BPM;
ArrayList<Twig> twigs = new ArrayList<Twig>();
ArrayList<Leaf> leaves = new ArrayList<Leaf>();
PGraphics paper;
float sceneTime = 0, speed = 1;
int lastMillis, seed = 241;
boolean paused = false, showHelp = false;

void settings() { size(1200, 800); smooth(4); }
void setup() {
  surface.setTitle("秋の余白 — Autumn Dusk");
  frameRate(30);
  buildScene();
  lastMillis = millis();
}

void buildScene() {
  randomSeed(seed); noiseSeed(seed);
  twigs.clear(); leaves.clear();
  // 左下と右端から入り込む枝。中央は黄昏の空白。
  branch(72, 830, 250, -1.13f, 4, 4.5f);
  branch(1240, 108, 245, 2.74f, 3, 3.1f);
  branch(-50, 480, 170, -0.48f, 2, 2.1f);
  paper = createGraphics(width, height);
  paper.beginDraw(); paper.clear(); paper.noStroke();
  for (int i = 0; i < 52000; i++) {
    float x = random(width), y = random(height);
    paper.fill(random(1) < 0.5 ? color(75, 53, 41, 11) : color(255, 243, 216, 20));
    paper.ellipse(x, y, random(0.5f, 1.8f), random(0.5f, 1.3f));
  }
  paper.endDraw();
}

void branch(float x, float y, float len, float angle, int depth, float weight) {
  float ex = x + cos(angle)*len, ey = y + sin(angle)*len;
  Twig twig = new Twig(x, y, ex, ey, weight, random(100));
  twigs.add(twig);
  if (depth <= 2) {
    for (int j = 0; j < 4; j++) {
      float p = 0.3f + j*0.2f;
      leaves.add(new Leaf(twig, p, angle + (j%2==0 ? -0.85f : 0.8f), random(15, 32)));
    }
  }
  if (depth > 0) {
    branch(ex, ey, len*random(0.62f, 0.75f), angle-random(0.23f, 0.5f), depth-1, weight*0.66f);
    branch(ex, ey, len*random(0.48f, 0.67f), angle+random(0.35f, 0.72f), depth-1, weight*0.6f);
  }
}

void draw() {
  int now = millis();
  float dt = min((now-lastMillis)/1000.0f, 0.1f);
  lastMillis = now;
  if (!paused) sceneTime += dt*speed;
  paintScene();
}

void paintScene() {
  // 一周約123秒。夕映えが深まり、ゆっくり次の黄昏へ戻ります。
  float dusk = 0.5f - 0.5f*cos(TWO_PI*sceneTime/SONG_SECONDS);
  int top = lerpColor(color(192, 182, 164), color(107, 115, 118), dusk);
  int bottom = lerpColor(color(235, 206, 157), color(185, 140, 115), dusk);
  for (int y = 0; y < height; y++) {
    stroke(lerpColor(top, bottom, pow(y/(float)height, 0.82f)));
    line(0, y, width, y);
  }
  // 太陽の輪郭を消す、淡い夕光。
  noStroke();
  for (int r = 210; r > 0; r -= 3) {
    fill(255, 219, 157, 0.48f*(1-dusk*0.5f));
    ellipse(width*0.69f, height*0.41f, r*2, r*2);
  }
  // 遠景の水面／記憶。波形ではなく、細い不連続な水平線。
  for (int i = 0; i < 34; i++) {
    float y = height*0.73f + i*6.8f;
    float x = width*0.37f + noise(i*0.2f)*190;
    float length = 50 + noise(i+40)*330;
    stroke(92, 93, 88, 10 + 5*sin(i)); strokeWeight(0.7f);
    line(x + sin(sceneTime*0.07f+i)*10, y, x+length, y);
  }
  for (Twig t : twigs) t.paint();
  for (Leaf l : leaves) l.paint(sceneTime);
  // スネアを連想する微かな点。4分の2・4拍目にだけ浮かびます。
  float beat = sceneTime*BPM/60;
  float beatInBar = beat%4;
  float pulse = exp(-max(0, (beatInBar-1+4)%2)*12);
  noStroke();
  for (int i = 0; i < 19; i++) {
    float x = 330 + noise(i*7.1f)*570;
    float y = 400 + noise(i*3.4f+80)*230;
    fill(112, 75, 49, 8 + pulse*17);
    ellipse(x, y, 1.3f, 1.3f);
  }
  image(paper, 0, 0);
  // 紙の縁。絵の中には操作ボタンを置かない。
  noFill(); stroke(244, 230, 204, 85); strokeWeight(18);
  rect(0, 0, width, height);
  if (showHelp) {
    noStroke(); fill(35, 36, 33, 190); rect(26, height-76, 720, 42, 4);
    fill(241, 226, 198); textSize(12);
    text("SPACE pause  /  R restart  /  N new  /  S save  /  UP-DOWN speed: " + nf(speed, 1, 2) + "x  /  H hide", 42, height-50);
  }
}

float ease(float a, float b, float x) {
  float t = constrain((x-a)/(b-a), 0, 1);
  return t*t*(3-2*t);
}

class Twig {
  float x, y, ex, ey, weight, phase;
  Twig(float a, float b, float c, float d, float w, float p) {
    x=a; y=b; ex=c; ey=d; weight=w; phase=p;
  }
  PVector point(float p) {
    return new PVector(lerp(x, ex, p)+sin(p*PI)*9, lerp(y, ey, p));
  }
  void paint() {
    noFill(); stroke(72, 61, 50, 155); strokeWeight(weight);
    beginShape();
    for (int i=0; i<=20; i++) {
      PVector p=point(i/20.0f); vertex(p.x, p.y);
    }
    endShape();
  }
}

class Leaf {
  Twig twig;
  float position, angle, size, offset, life, phase, drift;
  Leaf(Twig t, float p, float a, float s) {
    twig=t; position=p; angle=a; size=s;
    life=random(64, 105); offset=random(life); phase=random(TWO_PI); drift=random(40, 150);
  }
  void paint(float clock) {
    float age=((clock+offset)%life)/life;
    if (age > 0.97f) return; // 枝には少し何もない時間がある。
    float opening=ease(0, 0.16f, age);
    float autumn=ease(0.18f, 0.48f, age);
    float dry=ease(0.44f, 0.68f, age);
    float fall=ease(0.67f, 0.92f, age);
    float fade=1-ease(0.89f, 0.97f, age);
    PVector p=twig.point(position);
    float wind=sin(clock*0.5f+phase)*0.07f;
    float x=p.x+fall*drift+sin(fall*PI*3+phase)*fall*23;
    float ground=height-34-12*sin(phase);
    float y=lerp(p.y, max(p.y+45, ground), fall);
    int green=color(126, 134, 80), gold=color(195, 141, 58), rust=color(138, 74, 44);
    int tint=lerpColor(lerpColor(green, gold, autumn), rust, dry);
    // 落葉の淡い残像。履歴を蓄積せず、長時間動かしても重くしない。
    if (fall > 0 && fall < 0.98f) {
      leafShape(x-8*fall, y-13*fall, angle+wind+fall*3.5f, opening, dry, tint, fade*17);
    }
    leafShape(x, y, angle+wind+fall*3.5f+sin(fall*8)*0.25f,
      opening, dry, tint, fade*195);
  }
  void leafShape(float x, float y, float rotation, float opening, float dry, int tint, float alpha) {
    pushMatrix(); translate(x, y); rotate(rotation);
    float len=size*(0.13f+0.87f*opening)*(1-dry*0.17f);
    float w=len*(0.06f+0.30f*opening)*(1-dry*0.55f);
    float curl=dry*len*0.17f;
    noStroke(); fill(tint, alpha);
    beginShape(); vertex(0,0);
    bezierVertex(len*0.22f,-w, len*0.7f,-w, len, curl);
    bezierVertex(len*0.62f,w+curl, len*0.23f,w, 0,0);
    endShape(CLOSE);
    stroke(88, 65, 40, alpha*0.52f); strokeWeight(0.65f); noFill();
    bezier(-3, 0, len*0.3f, 0, len*0.65f, curl*0.3f, len, curl);
    for (int j=1; j<=3; j++) {
      float q=j*0.21f;
      line(len*q, curl*q*q, len*(q+0.17f), -w*0.56f+curl*q);
      line(len*q, curl*q*q, len*(q+0.12f), w*0.53f+curl*q);
    }
    popMatrix();
  }
}

void keyPressed() {
  if (key==' ') paused=!paused;
  if (key=='r' || key=='R') { sceneTime=0; lastMillis=millis(); }
  if (key=='n' || key=='N') { seed++; sceneTime=0; buildScene(); lastMillis=millis(); }
  if (key=='h' || key=='H') showHelp=!showHelp;
  if (key=='s' || key=='S') saveFrame("exports/autumn-"+seed+"-####.png");
  if (key==CODED && keyCode==UP) speed=min(4, speed*2);
  if (key==CODED && keyCode==DOWN) speed=max(0.25f, speed/2);
}
