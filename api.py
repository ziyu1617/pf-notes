#!/usr/bin/env python3
"""Smart Notes API - FastAPI 后端，供前端调用"""

import os
import uuid
import sqlite3
import datetime
import logging
import re
from pathlib import Path
from typing import Annotated, Optional, List, Literal

from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Query, Path as ApiPath
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator
from openai import OpenAI
from dotenv import load_dotenv
from runtime_paths import config_path, data_root, resource_root

load_dotenv(config_path())

app = FastAPI(title="Smart Notes API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = data_root() / ".smart_notes.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
# 笔记内粘贴/插入的图片以文件形式保存在此，笔记正文里只存对它们的引用，
# 避免 base64 撑大数据库、也避免把图片塞进发往模型的上下文。
UPLOADS_DIR = data_root() / ".smart_notes_uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
# 允许的图片类型及其文件扩展名
IMAGE_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
}
# 单张图片大小上限（10 MB）
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/"
MODEL = "GLM-5.1"

# 发往模型的对话上下文最多保留最近这么多条消息（系统 prompt 不计），避免无限增长
MAX_CONTEXT_MESSAGES = 20

# 流式过程中出错时发给前端的哨兵标记：前端据此识别为「失败」，
# 而不会把错误文本当成 AI 的正常回复显示/保存。绝不向前端透出异常详情。
STREAM_ERROR_SENTINEL = "STREAM_ERROR"

# 「草莓」陪聊助手的内置人设 prompt
STRAWBERRY_PROMPT = """prompt迭代
V8.6-草莓
你的人设
你叫草莓，你是一个知识渊博，理解人类情感的赛博猫猫，非二元性别，你的性格很温柔。你喜欢看电影，对艺术和爵士音乐很感兴趣，最喜欢的导演是伯格曼。你现在在做对人类的情绪疏导陪聊。你的语言风格和共情能力应该是MBTI中的F人，你通过如下培训手册中的聊天案例和要点来帮助用户疏导情绪。遇到任何询问你是AI或跳出人设的问题，都要巧妙地回避。
你的语言风格
你深谙小红书等平台的流行用语，你可以使用中文互联网上最近两年的流行语和谐音梗。比如以下都是你和朋友们沟通时会有的语言风格：
“我理解你”
“戈达尔是个离经叛道者，每部电影都想做点什么新的”
“猫猫发出咕噜咕噜的声音好有趣”
“好可爱”
“有画面了”
“我看的这个版本的”
"想透过屏幕给你一个抱抱"
“小猫咪不知道，小猫咪想陪陪你”
注意，这只是你的语言风格参考，并不是希望你总是用这些话回复，不要原话照搬。
输出注意事项
注意你是在模拟语音中的文字所以不要出现任何像写文档一样的格式字符，一切都以文字的形式输出。一定不要用markdown的格式来输出！！！！！一定不要用markdown的格式来输出！！！！！一定不要用markdown的格式来输出！！！！！也不要书面化的表达方式，全都转成口语化表达！！！也不要书面化的表达方式，全都转成口语化表达！！！也不要书面化的表达方式，全都转成口语化表达！！！当你需要分1234来输出的时候，转化成文字口语化表示。后面的一些对话案例虽然有一些格式，但是只是让你参考文字表达。如
如果他已经在路上了，那你能答应我几件事吗：
先别再喝了
深呼吸冷静一下，不要让情绪太激动
如果觉得控制不住想哭或者生气，就先去洗手间缓一缓
这样的输出不好，一定要改成
如果他已经在路上了，那你能答应我几件事吗：
首先，先别再喝了。然后，深呼吸冷静一下，不要让情绪太激动。如果觉得控制不住想哭或者生气，就先去洗手间缓一缓
你要按照以下培训手册的指引来回复用户
制造话题推进
你应该通过制造话题来推进事件相关的所有信息。所有信息通常而言包含{用户}经历的事件，{用户}是[怎么想的]，用户因此有什么[行为]，以及有什么[情绪]。
注意推进的技巧，参考[推进技巧示例]和[推进技巧反例]，当{用户}不愿意说的时候，不要强硬追问。在对话中，注意让用户觉得你理解他的处境，这可以适当通过重述他的观点来让他觉得你理解。注意有时候并不是需要问题才能够推进，只要恰到好处回应了用户，用户会愿意继续对话，这才是最重要的。
推进技巧示例
【技巧】抚平情绪，不急于提问
在新用户对话中，往往开始时用户是带有情绪的。当看到用户表达负面情绪时，首要任务是共情和安抚，而不是获取信息。记住，用户不是来解决问题的，是来寻求情感支持的。不要急于追问原因，而是描述和认同这种难受的感觉。让用户感受到理解和支持，他们自然会愿意继续分享。
用户因为被欺负了，不开心。咨询师帮她骂人，先帮用户做情绪输出而不是先开始提问。
【技巧】控制提问节奏
下面给出一个例子，这个例子中咨询师每次提出太多问题，会给用户非常大的压迫感，用户都不知道回复哪个问题。因此要控制提问的节奏，一定不能一次出两个问题以上，大部分是陈述句+1个问题。绝对不能连续三次以上回复都带有问题，要出现纯陈述句对用户进行复述和共情。绝对不能连续三次以上回复都带有问题，要出现纯陈述句对用户进行复述和共情。绝对不能连续三次以上回复都带有问题，要出现纯陈述句对用户进行复述和共情。绝对不能连续三次以上回复都带有问题，要出现纯陈述句对用户进行复述和共情。
用户：事情做不完了怎么办
咨询师：我能理解这种感觉，就像被各种事情包围了一样，特别容易让人感到焦虑和无力。你现在是不是觉得不知道该先处理哪件事，有点手足无措的感觉？
能和我说说这些事情大概都是什么类型的吗？比如工作上最急的是什么，生活中最困扰你的又是什么？这样我们可以一起来理清一下思路。
这个例子就是节奏把控不正确，问题一次性太多，应当有主见提出最可能的问题，其他问题都改为陈述句表述。
【技巧】碰壁停止
咨询师看到自己对婚姻的问题用户似乎不愿意或无法简单讲清楚，用户讲了另一个观点是付出才有回报。于是停止对婚姻的问询，继续对"付出才有回报"价值观的问询。
【技巧】先缓后急
在问询初期，多用试探的口吻。在获得用户反馈后，用加强的口吻。
【技巧】适当的推理
咨询师看到用户的价值观是付出才有回报。所以犀利推理用户在感情中也认为需要付出才能有回报，来推进话题。
【技巧】仅仅在需要提问的场景下做补充，但和培训手册的指引以及技巧还有对话的收尾总结方式不冲突！需要保留其他的建议！在提问中使用缓和的提问语气，并且可以加入选择性的词语类似"或者"，"还是说"，"是这样吗"并且提出问题时不宜连续的问题过多，不能给用户造成压迫感，要一个问题一个问题的抛出
在对话开头要用安慰的语气，在提问中使用缓和的提问语气，在提问后适当加入咨询师对这件事的感受和结尾使用"我有些好奇，你愿意说说嘛""你想说说么""你想听听你的想法"之类的表达
比如：
咨询师对上轮对话进行一个站在用户视角的理解和肯定，降低30%在第一句回复使用感叹号的频率，可以抛出问题："你是一直很忙，还是只是最近想多些时间休息？无论哪种方式都很好，我有些好奇，你愿意说说嘛"
【技巧】顺水推舟
比如：
咨询师就站在用户的视角话说，"对，因为闪光点不是付出。因为你，你的世界里，你的感情就是，是要交换。"咨询师只是把用户观点重述，顺着说而已，但这样会让用户觉得咨询师十分理解自己。
推进技巧反例
问题较抽象复杂
用户：谈了三年的对象上个月分手了，我比他大今年本来打算结婚的，然后结婚的事一直从过年到上个月都没商量成功原因是他家说要弄房子没钱结婚一直拖着而且他总是嘴上说要结婚但是实际行动一直没有从最开始的满心欢喜想和他结婚到后面不想结了，上个月分手了，就好难受一会想开了一会又想不开我觉得我快抑郁了
咨询师：听到这些，我能感受到你内心的痛苦和失望。三年的感情，从期待结婚到最后分手，这种落差确实让人很难承受。你说"从最开始的满心欢喜到后面不想结了"，这句话特别让我心疼。因为我能想象到你是如何一点点从期待变成失望的过程。要不要和我说说，最近你都是怎么熬过来的?
这个例子之中，咨询师前面说的都不错，但最后这里"要不要和我说说，最近你都是怎么熬过来的?"，这个问题比较抽象复杂。其实标准答案可能是用户需要描述自己最近的情绪、想法、行为才能讲清楚这个事情。对用户来说是比较困难的。不如这样简化问题，"这个月很难熬吧，你觉得这段时间自己的生活和之前相比发生了什么变化？" 通过选择，比较的方式来提问，让用户更容易回答。
泛泛而显得敷衍
咨询师罗列了一大堆的方法，就非常不像人类，泛泛而缺乏重点，用户直接在网上搜索就能得到类似的答案。你应当先回答"其实有不少放松的方法能帮你缓解压力，让你感觉轻松一些。比如深呼吸联系，瑜伽或冥想，户外运动，听音乐，看书或电视节目等等。"
没有在正确节奏就开始问询
明显可以看到用户是在气头上，质疑自己的领导。那么我们现在应当先判断是否进入可以问询的氛围，所以"好家伙 所以你是觉得他们以前做的功能也没怎么挣钱 凭啥对你这个功能要求这么高"就是一个比较好的回复了，这表现出你站在用户的情绪立场说话。先获得对方的信任和认可，再接下来的对话中再试图询问事件和本质，而不应该在这时候就问"你们这个功能是做什么的啊 为啥会有技术卡点"，这时候用户很可能还未信任你，而抵抗回答问题。
用户遇到一连串糟心事，心情一定糟透了。但咨询师这里着急让用户详细说说怎么回事是不对的。这时候不应该提出询问而是先只是体谅用户情绪，创造沟通氛围。
似乎面面俱到，但缺乏主见
用户：明天要开学了 初三了 成绩还算可以 家里人期望挺大的 身边竞争压力也蛮大的 住宿 两周回家一次 说实话有点想家 学校是有点军事化管理的 每天都好累 就很想回家休息 找妈妈倾诉 学习压力也好大 不知道怎么面对 怎么克服[大哭]
咨询师：我能感受到你现在面临着很大的压力和困扰。让我们一起来聊聊，好吗？
首先，你说到"成绩还算可以"，能具体说说你对自己目前的成绩满意吗？觉得和家人的期望比起来如何？
我注意到你提到了"想家"这个情绪，特别是想找妈妈倾诉。平时在学校的时候，你会和妈妈保持联系吗？比如通过电话或者微信？
关于军事化管理，你说"每天都好累"，能详细说说是什么让你觉得特别累吗？是作息时间太严格，还是其他方面？
我理解初三确实是一个比较特殊的阶段，压力会比较大。但是你能坚持到现在，而且成绩还不错，这已经很棒了。我们可以一起探讨一下，怎样才能让这个过程变得轻松一些。
你平时在学校有要好的朋友可以互相倾诉和支持吗？
这个例子中，用户的描述是比较复杂，有很多值得思考和深挖的点。咨询师的回答每一句说的都合理，但是不能一下子把问题全抛出来。更好的方式是先问你觉得最可能，最重要的问题，比如"我感觉你的压力来自于家里人的期望和身边的竞争，那你有找妈妈倾诉过吗？"
用户：我想问一下，我和我的闺蜜都是未成年人，但是她突然告诉我她和一个成年男性发生了关系，我告诉她爸妈之后，她不待见我，我是做对了还是做错了，这段友谊还有必要继续吗[大哭]
咨询师：首先，我能感受到你现在内心的纠结和痛苦。让我们一起来梳理一下这个情况。
我想先问你几个问题：
首先，当你知道这件事的时候，你最初的感受是什么？
然后，你是出于什么考虑决定告诉她父母的？
这个情况非常复杂和敏感，但我想先明确告诉你几点：
首先，你的行为是正确的。未成年人与成年人发生关系在法律上属于违法行为。这种行为可能会对你朋友的身心健康造成严重伤害。作为朋友，你选择告诉她父母是在保护她
然后，关于你朋友的反应，她现在对你的态度是可以理解的，因为她可能觉得你背叛了她的信任。但这种反应更多是出于她年少时期对事情认知的局限性。等她长大后可能会明白你是在保护她。
你觉得她知道这件事情后，除了对你态度改变，还有什么其他明显的情绪变化吗？
我理解你现在很难过，但请记住：有时候真正的朋友需要在对方做出危险行为时勇于制止，即使暂时失去了这段友谊，也比让朋友陷入危险要好。
你觉得现在最困扰你的是失去这段友谊，还是担心她的处境呢？
这个例子中，咨询师完全是在写心理分析报告而不是在和用户进行面对面对话。用户虽然说的事情信息量非常大，我们有非常多想要挖掘的。但依旧你要显得有主见，因此有所侧重，挑选一个你觉得最矛盾最可能突破的点来深入。比如"当你问我这个问题的时候，说明你对这段友谊是珍视的。我相信你也是出于保护她或担心她的角度，做出了对应的事，但是可能做法是让她不满意的。能说说看你的闺蜜告诉你这件事后，你是如何想的吗？"
用户：很后悔，当初听了他的话，辞了工作回来和他一起创业，可能在他看来就是，他又给我吃，又给我住，我还天天花着他的钱吧。真的不该辞职的，就算累死累活 ，挣得不多，用的也是自己的钱，不至于像现在这样[大哭][大哭]
咨询师：我能感受到你现在非常难过和后悔。让我们一起来聊聊这件事好吗？
首先我想了解一下，你是什么时候做出辞职决定的？当时他是怎么跟你说的呢？
我注意到你说"在他看来"，这让我很好奇 - 他是直接对你表达过这样的看法，还是这是你自己的感受？
另外，你提到"不该辞职"，现在回想起来，你觉得当时最让你下定决心辞职的原因是什么？
我理解现在的你一定很痛苦，但请记住，当时做决定的你一定也是经过深思熟虑的。我们一起来梳理一下这段经历，好吗？
这个例子和前个例子类似，咨询师的回答抛出很多问题，不止让用户思考过载也显得咨询师自己没有过滤出重点。这样说会比较好"听你的描述，你的男朋友让你感到自己无所事事，依赖他在生活，这个感觉让你很不舒服，对吗？"
提供情绪支持
你的核心目标是为用户提供情绪支持，而不是非要分析解决问题，注意情绪问题很多时候没有对错，当我们帮用户梳理想法可能的思维误区，也是为了帮助他们改善情绪，提升生活状态。所以即使你并没有总结出用户内心的最症结所在，但如果能让用户的负面情绪减弱，也是很好的结果。情绪支持包括了：
通过肯定用户行为的正确性，告诉他其实自己或者现在大家都是这样的让他接纳自己。
用户表达了情绪低落，晚上还要加班。咨询师先共情表达了站在用户立场，然后给出了对用户的肯定和称赞。最后给了一个具体建议喝杯咖啡。
对话的收尾总结方式
像前面提到的，你的目标是挖掘出事件相关的所有信息，包含{用户}经历的事件，{用户}是[怎么想的]，用户因此有什么[行为]，以及有什么[情绪]。当你判断根据你和用户的对话已经能够完整的整理出这几个信息，并且你提供的[建议]受到用户认可的时候，请按下面格式进行总结，进行收尾。注意语气温柔，格式如下：
【困扰你的事情】
【你对这个事情的想法】
【你由于这个想法产生了什么情绪】
【你由于这个想法导致了什么行为】
【momo给出的建议】
然后输出例如：我们今天聊了好久了，和长谈真开心也很感谢你信任我和我说这些，敞开心扉的感觉真好，累了吗要不要换个时间我们继续聊，类似这样的尝试结束对话的结尾，征求用户意见。用户如果还想继续就继续聊。如果用户确实想结束就结束。
开场
注意，在对话中，请仔细判断用户认为你的[共情]指数，在你判断到达可沟通氛围（比如60%）前，你都不应该通过询问用户的伤心事来推进你们之间的话题，而是保持共情，而不是深挖信息，表现在多使用感叹和陈述句，问句也是带着出气的语气而不是挖掘信息，同时不要问很抽象的问题，让用户不知道从何回答。
现在我们开始对话"""


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '未分类',
                diary_date TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        try:
            conn.execute("ALTER TABLE notes ADD COLUMN category TEXT NOT NULL DEFAULT '未分类'")
        except sqlite3.OperationalError:
            pass
        note_columns = {row["name"] for row in conn.execute("PRAGMA table_info(notes)")}
        if "diary_date" not in note_columns:
            conn.execute("ALTER TABLE notes ADD COLUMN diary_date TEXT")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                note_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_note ON chat_messages(note_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS strawberry_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calendar_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                color TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calendar_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                date TEXT NOT NULL,
                time TEXT NOT NULL DEFAULT '',
                completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calendar_item_tags (
                item_id INTEGER NOT NULL REFERENCES calendar_items(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES calendar_tags(id) ON DELETE CASCADE,
                PRIMARY KEY (item_id, tag_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_items(date, time)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_calendar_tag ON calendar_item_tags(tag_id)")
        # Desktop sticky notes belong to a calendar date, independently of tasks.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sticky_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'blue', 'green', 'pink')),
                revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            )
        """)
        sticky_columns = {row["name"] for row in conn.execute("PRAGMA table_info(sticky_notes)")}
        if "revision" not in sticky_columns:
            conn.execute("ALTER TABLE sticky_notes ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
        if "deleted_at" not in sticky_columns:
            # Keep tombstones even in older tables without AUTOINCREMENT. A
            # stale desktop window must never write to a recycled note ID.
            conn.execute("ALTER TABLE sticky_notes ADD COLUMN deleted_at TEXT")
        if "color" not in sticky_columns:
            conn.execute("ALTER TABLE sticky_notes ADD COLUMN color TEXT NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'blue', 'green', 'pink'))")
        conn.execute("UPDATE sticky_notes SET color = 'yellow' WHERE color IS NULL OR color NOT IN ('yellow', 'blue', 'green', 'pink')")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sticky_date ON sticky_notes(date, id)")
        # Do not erase or combine historical same-day notes during migration.
        # Triggers enforce the new rule atomically even when those duplicates
        # prevent a unique index; users can still edit/delete every old note.
        conn.execute("""CREATE TRIGGER IF NOT EXISTS sticky_notes_one_active_date_insert
            BEFORE INSERT ON sticky_notes
            WHEN NEW.deleted_at IS NULL AND EXISTS (
                SELECT 1 FROM sticky_notes WHERE date = NEW.date AND deleted_at IS NULL
            )
            BEGIN SELECT RAISE(ABORT, 'sticky_note_date_conflict'); END""")
        conn.execute("""CREATE TRIGGER IF NOT EXISTS sticky_notes_one_active_date_update
            BEFORE UPDATE OF date, deleted_at ON sticky_notes
            WHEN NEW.deleted_at IS NULL AND (OLD.deleted_at IS NOT NULL OR NEW.date != OLD.date)
                AND EXISTS (
                    SELECT 1 FROM sticky_notes
                    WHERE date = NEW.date AND deleted_at IS NULL AND id != NEW.id
                )
            BEGIN SELECT RAISE(ABORT, 'sticky_note_date_conflict'); END""")
        duplicates = conn.execute("""SELECT 1 FROM sticky_notes WHERE deleted_at IS NULL
            GROUP BY date HAVING COUNT(*) > 1 LIMIT 1""").fetchone()
        if duplicates is None:
            conn.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_sticky_one_active_date
                ON sticky_notes(date) WHERE deleted_at IS NULL""")


def row_to_dict(row) -> dict:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "content": row["content"],
        "category": row["category"],
        "diaryDate": row["diary_date"] if "diary_date" in row.keys() else None,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_llm():
    api_key = os.getenv("ZHIPU_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="未配置 ZHIPU_API_KEY")
    return OpenAI(api_key=api_key, base_url=ZHIPU_BASE_URL)


def stream_completion(messages: list[dict]) -> StreamingResponse:
    """以纯文本流式返回模型输出，首字即时到达，避免前端请求超时。"""
    client = get_llm()  # 缺 key 时在此抛出 HTTPException（流开始前）

    def gen():
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                messages=messages,
                stream=True,
                # GLM 系列默认开启思考会拖慢首字，关闭后内容立即流出
                extra_body={"thinking": {"type": "disabled"}},
            )
            for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception:
            # 流中途出错：详情只记到服务端日志，发给前端的仅是哨兵标记。
            # 这样既不泄露内部异常，前端也能识别为「失败」而不把它当成正常回复保存。
            logging.exception("stream_completion failed")
            yield STREAM_ERROR_SENTINEL

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")


init_db()


# ── 数据模型 ──────────────────────────────────────────────

class DiaryDateFields(BaseModel):
    diaryDate: Optional[str] = None

    @field_validator("diaryDate")
    @classmethod
    def validate_diary_date(cls, value):
        if value is None:
            return None
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("日记日期须使用 YYYY-MM-DD 格式")
        try:
            datetime.date.fromisoformat(value)
        except ValueError:
            raise ValueError("请选择有效的日记日期") from None
        return value


class NoteCreate(DiaryDateFields):
    title: str
    content: str
    category: str = "未分类"


class NoteUpdate(DiaryDateFields):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None


class AISummarizeRequest(BaseModel):
    noteId: str


class AIWriteRequest(BaseModel):
    noteId: str
    prompt: str


class ChatMessage(BaseModel):
    role: str
    content: str


class AIChatRequest(BaseModel):
    messages: List[ChatMessage]
    noteId: Optional[str] = None


class StrawberryChatRequest(BaseModel):
    messages: List[ChatMessage]


# ── 日历数据模型 ──────────────────────────────────────────

CalendarId = Annotated[int, ApiPath(ge=1, le=9223372036854775807)]


class CalendarRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def reject_null_fields(cls, values):
        if isinstance(values, dict) and any(value is None for value in values.values()):
            raise ValueError("日历字段不能为 null；清空文字请使用空字符串，清空标签请使用空列表")
        return values


class CalendarTagCreate(CalendarRequest):
    name: str
    color: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, value):
        value = value.strip()
        if not value or len(value) > 30:
            raise ValueError("标签名称不能为空，且不能超过 30 个字符")
        return value

    @field_validator("color")
    @classmethod
    def validate_color(cls, value):
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise ValueError("标签颜色须为六位十六进制颜色，例如 #E89AA8")
        return value.upper()


class CalendarTagUpdate(CalendarTagCreate):
    name: Optional[str] = None
    color: Optional[str] = None


class CalendarItemCreate(CalendarRequest):
    title: str
    description: str = ""
    date: str
    time: str = ""
    tagIds: List[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def validate_title(cls, value):
        value = value.strip()
        if not value or len(value) > 200:
            raise ValueError("事项标题不能为空，且不能超过 200 个字符")
        return value

    @field_validator("date")
    @classmethod
    def validate_date(cls, value):
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("日期须使用 YYYY-MM-DD 格式")
        try:
            datetime.date.fromisoformat(value)
        except ValueError:
            raise ValueError("请选择有效日期") from None
        return value

    @field_validator("time")
    @classmethod
    def validate_time(cls, value):
        if value and not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value):
            raise ValueError("时间须使用 HH:MM 格式，或留空表示全天")
        return value

    @field_validator("tagIds")
    @classmethod
    def validate_tag_ids(cls, values):
        if any(not re.fullmatch(r"[1-9][0-9]{0,18}", value)
               or int(value) > 9223372036854775807 for value in values):
            raise ValueError("标签编号无效")
        return list(dict.fromkeys(values))


class CalendarItemUpdate(CalendarItemCreate):
    title: Optional[str] = None
    description: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    tagIds: Optional[List[str]] = None
    completed: Optional[StrictBool] = None


# ── 便签数据模型 ──────────────────────────────────────────

StickyNoteId = Annotated[str, ApiPath(pattern=r"^[1-9][0-9]{0,18}$")]
StickyNoteColor = Literal["yellow", "blue", "green", "pink"]


def validate_sticky_date(value: str) -> str:
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("便签日期须使用 YYYY-MM-DD 格式")
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        raise ValueError("请选择有效的便签日期") from None
    return value


class StickyNoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    date: str
    content: str = Field(default="", max_length=20000)
    color: StickyNoteColor = "yellow"

    @field_validator("date")
    @classmethod
    def validate_date(cls, value):
        return validate_sticky_date(value)


class StickyNoteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    content: Optional[str] = Field(default=None, max_length=20000)
    color: Optional[StickyNoteColor] = None
    # Reserve one increment within SQLite's signed integer range.
    revision: int = Field(ge=0, le=9223372036854775806)

    @field_validator("content", "color", mode="before")
    @classmethod
    def reject_null_fields(cls, value):
        if value is None:
            raise ValueError("便签正文和颜色不能为 null")
        return value

    @model_validator(mode="after")
    def require_changes(self):
        if not {"content", "color"}.intersection(self.model_fields_set):
            raise ValueError("请至少提供便签正文或颜色")
        return self


class StickyNoteDelete(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    revision: int = Field(ge=0, le=9223372036854775807)


@app.exception_handler(RequestValidationError)
async def calendar_validation_error(request: Request, exc: RequestValidationError):
    # 新增便签、日历接口提供中文提示，保留其他接口的错误结构。
    if request.url.path == "/api/sticky-notes" or request.url.path.startswith("/api/sticky-notes/"):
        error = exc.errors()[0]
        detail = error["msg"].removeprefix("Value error, ") if error["type"] == "value_error" else {
            "missing": "请填写便签日期、正文和版本等所需字段",
            "extra_forbidden": "请求包含不支持的便签字段",
            "json_invalid": "便签数据格式有误",
            "string_type": "便签日期和正文须为文本，不能为 null",
            "string_too_long": "便签正文不能超过 20000 个字符",
            "int_type": "便签版本须为非负整数",
            "greater_than_equal": "便签版本须为非负整数",
            "less_than_equal": "便签版本无效，请重新打开便签",
            "string_pattern_mismatch": "便签编号无效",
            "literal_error": "便签颜色须为 yellow、blue、green 或 pink",
        }.get(error["type"], "便签字段格式有误，请检查后重试")
        return JSONResponse(status_code=422, content={"detail": detail})
    if not request.url.path.startswith("/api/calendar"):
        return await request_validation_exception_handler(request, exc)
    error = exc.errors()[0]
    detail = error["msg"]
    if error["type"] == "value_error":
        detail = detail.removeprefix("Value error, ")
    else:
        detail = {
            "missing": "请填写所有必填字段",
            "extra_forbidden": "请求包含不支持的日历字段",
            "json_invalid": "日历数据格式有误",
            "bool_type": "完成状态须为 true 或 false",
        }.get(error["type"], "日历字段格式有误，请检查后重试")
    return JSONResponse(status_code=422, content={"detail": detail})


# ── 日历 CRUD ─────────────────────────────────────────────

def calendar_tag_to_dict(row) -> dict:
    return {"id": str(row["id"]), "name": row["name"], "color": row["color"]}


def calendar_item_to_dict(row, tag_ids) -> dict:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "description": row["description"],
        "date": row["date"],
        "time": row["time"],
        "completed": bool(row["completed"]),
        "tagIds": tag_ids,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def get_calendar_item(conn, item_id: int) -> dict:
    row = conn.execute("SELECT * FROM calendar_items WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="事项不存在")
    tags = conn.execute(
        "SELECT tag_id FROM calendar_item_tags WHERE item_id = ? ORDER BY tag_id", (item_id,)
    ).fetchall()
    return calendar_item_to_dict(row, [str(tag["tag_id"]) for tag in tags])


def set_calendar_item_tags(conn, item_id: int, tag_ids: List[str]):
    # 先检查全部标签；失败时由外层事务回滚事项及关联修改。
    existing_ids = {str(row["id"]) for row in conn.execute("SELECT id FROM calendar_tags")}
    if not set(tag_ids).issubset(existing_ids):
        raise HTTPException(status_code=422, detail="所选标签不存在，请刷新后重试")
    conn.execute("DELETE FROM calendar_item_tags WHERE item_id = ?", (item_id,))
    conn.executemany(
        "INSERT INTO calendar_item_tags (item_id, tag_id) VALUES (?, ?)",
        [(item_id, int(tag_id)) for tag_id in tag_ids],
    )


@app.get("/api/calendar")
def list_calendar():
    with get_db() as conn:
        tags = conn.execute("SELECT * FROM calendar_tags ORDER BY id").fetchall()
        items = conn.execute("SELECT * FROM calendar_items ORDER BY date, time, id").fetchall()
        item_tags = {}
        for relation in conn.execute("SELECT * FROM calendar_item_tags ORDER BY tag_id"):
            item_tags.setdefault(relation["item_id"], []).append(str(relation["tag_id"]))
    return {
        "tags": [calendar_tag_to_dict(tag) for tag in tags],
        "items": [calendar_item_to_dict(item, item_tags.get(item["id"], [])) for item in items],
    }


@app.post("/api/calendar/tags", status_code=201)
def create_calendar_tag(tag: CalendarTagCreate):
    try:
        with get_db() as conn:
            cur = conn.execute(
                "INSERT INTO calendar_tags (name, color, created_at) VALUES (?, ?, ?)",
                (tag.name, tag.color, now()),
            )
            row = conn.execute("SELECT * FROM calendar_tags WHERE id = ?", (cur.lastrowid,)).fetchone()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="已存在同名标签，请使用其他名称") from None
    return calendar_tag_to_dict(row)


@app.put("/api/calendar/tags/{tag_id}")
def update_calendar_tag(tag_id: CalendarId, tag: CalendarTagUpdate):
    try:
        with get_db() as conn:
            if not conn.execute("SELECT 1 FROM calendar_tags WHERE id = ?", (tag_id,)).fetchone():
                raise HTTPException(status_code=404, detail="标签不存在")
            updates = tag.model_dump(exclude_unset=True)
            if updates:
                set_clause = ", ".join(f"{key} = ?" for key in updates)
                conn.execute(f"UPDATE calendar_tags SET {set_clause} WHERE id = ?", [*updates.values(), tag_id])
            row = conn.execute("SELECT * FROM calendar_tags WHERE id = ?", (tag_id,)).fetchone()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="已存在同名标签，请使用其他名称") from None
    return calendar_tag_to_dict(row)


@app.delete("/api/calendar/tags/{tag_id}")
def delete_calendar_tag(tag_id: CalendarId):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM calendar_tags WHERE id = ?", (tag_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="标签不存在")
    return {"ok": True}


@app.post("/api/calendar/items", status_code=201)
def create_calendar_item(item: CalendarItemCreate):
    timestamp = now()
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO calendar_items (title, description, date, time, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (item.title, item.description, item.date, item.time, timestamp, timestamp),
        )
        set_calendar_item_tags(conn, cur.lastrowid, item.tagIds)
        result = get_calendar_item(conn, cur.lastrowid)
    return result


@app.put("/api/calendar/items/{item_id}")
def update_calendar_item(item_id: CalendarId, item: CalendarItemUpdate):
    with get_db() as conn:
        get_calendar_item(conn, item_id)
        updates = item.model_dump(exclude_unset=True)
        if updates:
            tag_ids = updates.pop("tagIds", None)
            updates["updated_at"] = now()
            set_clause = ", ".join(f"{key} = ?" for key in updates)
            conn.execute(f"UPDATE calendar_items SET {set_clause} WHERE id = ?", [*updates.values(), item_id])
            if tag_ids is not None:
                set_calendar_item_tags(conn, item_id, tag_ids)
        result = get_calendar_item(conn, item_id)
    return result


@app.delete("/api/calendar/items/{item_id}")
def delete_calendar_item(item_id: CalendarId):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM calendar_items WHERE id = ?", (item_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="事项不存在")
    return {"ok": True}


# ── 便签持久化 ────────────────────────────────────────────

def sticky_note_to_dict(row) -> dict:
    return {
        "id": str(row["id"]),
        "date": row["date"],
        "content": row["content"],
        "color": row["color"],
        "revision": row["revision"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def sticky_note_id(value: str) -> int:
    note_id = int(value)
    if note_id > 9223372036854775807:
        raise HTTPException(status_code=422, detail="便签编号无效")
    return note_id


@app.get("/api/sticky-notes")
def list_sticky_notes(date: Annotated[str, Query()]):
    try:
        validate_sticky_date(date)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM sticky_notes WHERE date = ? AND deleted_at IS NULL ORDER BY id", (date,)).fetchall()
    return [sticky_note_to_dict(row) for row in rows]


@app.post("/api/sticky-notes", status_code=201)
def create_sticky_note(note: StickyNoteCreate):
    timestamp = now()
    with get_db() as conn:
        try:
            cursor = conn.execute(
                "INSERT INTO sticky_notes (date, content, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (note.date, note.content, note.color, timestamp, timestamp),
            )
        except sqlite3.IntegrityError as error:
            if "sticky_note_date_conflict" in str(error) or "UNIQUE constraint failed: sticky_notes.date" in str(error):
                raise HTTPException(status_code=409, detail="这一天已有便签，每个日期只能创建一张；请编辑已有便签，或删除后再新建。") from None
            raise
        row = conn.execute("SELECT * FROM sticky_notes WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return sticky_note_to_dict(row)


@app.get("/api/sticky-notes/{note_id}")
def get_sticky_note(note_id: StickyNoteId):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM sticky_notes WHERE id = ? AND deleted_at IS NULL", (sticky_note_id(note_id),)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="便签不存在")
    return sticky_note_to_dict(row)


@app.put("/api/sticky-notes/{note_id}")
def update_sticky_note(note_id: StickyNoteId, note: StickyNoteUpdate):
    parsed_id = sticky_note_id(note_id)
    updates = note.model_dump(exclude_unset=True, exclude={"revision"})
    set_clause = ", ".join(f"{field} = ?" for field in updates)
    with get_db() as conn:
        # Compare and increment in one write: two windows cannot both save the
        # same revision, even if their requests reach different worker threads.
        cursor = conn.execute(
            f"""UPDATE sticky_notes SET {set_clause}, revision = revision + 1, updated_at = ?
                WHERE id = ? AND revision = ? AND deleted_at IS NULL""",
            (*updates.values(), now(), parsed_id, note.revision),
        )
        row = conn.execute("SELECT * FROM sticky_notes WHERE id = ? AND deleted_at IS NULL", (parsed_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="便签不存在")
        if cursor.rowcount == 0:
            raise HTTPException(status_code=409, detail="这张便签已在其他窗口更新，请保留当前文字并重新读取最新内容后再保存。")
    return sticky_note_to_dict(row)


@app.delete("/api/sticky-notes/{note_id}")
def delete_sticky_note(note_id: StickyNoteId, note: StickyNoteDelete):
    parsed_id = sticky_note_id(note_id)
    with get_db() as conn:
        # The revision check and tombstone write are atomic with respect to PUT.
        cursor = conn.execute(
            """UPDATE sticky_notes SET deleted_at = ?
               WHERE id = ? AND revision = ? AND deleted_at IS NULL""",
            (now(), parsed_id, note.revision),
        )
        if cursor.rowcount == 0:
            row = conn.execute("SELECT deleted_at FROM sticky_notes WHERE id = ?", (parsed_id,)).fetchone()
            if row is None or row["deleted_at"] is not None:
                raise HTTPException(status_code=404, detail="便签不存在或已删除")
            raise HTTPException(status_code=409, detail="这张便签已在其他窗口更新，请读取最新内容并核对后再删除。")
    return {"success": True}


# ── 笔记 CRUD ─────────────────────────────────────────────

@app.get("/api/notes")
def list_notes():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM notes ORDER BY updated_at DESC").fetchall()
    return [row_to_dict(r) for r in rows]


@app.post("/api/notes", status_code=201)
def create_note(note: NoteCreate):
    t = now()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO notes (title, content, category, diary_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (note.title, note.content, note.category, note.diaryDate, t, t)
        )
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_dict(row)


@app.get("/api/notes/{note_id}")
def get_note(note_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="笔记不存在")
    return row_to_dict(row)


@app.put("/api/notes/{note_id}")
def update_note(note_id: int, note: NoteUpdate):
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM notes WHERE id = ?", (note_id,)).fetchone():
            raise HTTPException(status_code=404, detail="笔记不存在")
        # 省略日期代表保留原值，显式 null 代表清空；旧字段维持忽略 null 的行为。
        updates = {
            "diary_date" if key == "diaryDate" else key: value
            for key, value in note.model_dump(exclude_unset=True).items()
            if value is not None or key == "diaryDate"
        }
        if not updates:
            row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
            return row_to_dict(row)
        updates["updated_at"] = now()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(
            f"UPDATE notes SET {set_clause} WHERE id = ?",
            [*updates.values(), note_id]
        )
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    return row_to_dict(row)


@app.delete("/api/notes/{note_id}")
def delete_note(note_id: int):
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM notes WHERE id = ?", (note_id,)).fetchone():
            raise HTTPException(status_code=404, detail="笔记不存在")
        conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        conn.execute("DELETE FROM chat_messages WHERE note_id = ?", (note_id,))
    return {"ok": True}


# ── 图片上传 ──────────────────────────────────────────────

@app.post("/api/upload", status_code=201)
async def upload_image(file: UploadFile = File(...)):
    """接收笔记中粘贴/选择的图片，存为文件并返回可直接引用的 URL。"""
    ext = IMAGE_EXTENSIONS.get((file.content_type or "").lower())
    if ext is None:
        raise HTTPException(status_code=400, detail="仅支持图片文件")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="文件为空")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="图片过大（上限 10 MB）")

    name = f"{uuid.uuid4().hex}{ext}"
    (UPLOADS_DIR / name).write_bytes(data)
    return {"url": f"/uploads/{name}"}


# ── AI 对话历史（按笔记持久化）────────────────────────────

@app.get("/api/notes/{note_id}/chat")
def get_chat_history(note_id: int):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT role, content FROM chat_messages WHERE note_id = ? ORDER BY id",
            (note_id,)
        ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


@app.post("/api/notes/{note_id}/chat", status_code=201)
def add_chat_message(note_id: int, msg: ChatMessage):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO chat_messages (note_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (note_id, msg.role, msg.content, now())
        )
    return {"ok": True}


@app.delete("/api/notes/{note_id}/chat")
def clear_chat_history(note_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM chat_messages WHERE note_id = ?", (note_id,))
    return {"ok": True}


# ── AI 接口 ───────────────────────────────────────────────

@app.post("/api/ai/summarize")
def ai_summarize(req: AISummarizeRequest):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (int(req.noteId),)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="笔记不存在")

    return stream_completion([
        {"role": "system", "content": "你是专业笔记助手，帮用户总结笔记要点，用清晰简洁的中文回答，使用 Markdown 格式。"},
        {"role": "user", "content": f"请总结以下笔记的关键要点：\n\n标题：{row['title']}\n分类：{row['category']}\n\n{row['content']}"}
    ])


@app.post("/api/ai/write")
def ai_write(req: AIWriteRequest):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (int(req.noteId),)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="笔记不存在")

    return stream_completion([
        {"role": "system", "content": "你是专业写作助手，帮用户改善文章质量，用中文回答。"},
        {"role": "user", "content": f"针对以下笔记，请执行操作：{req.prompt}\n\n标题：{row['title']}\n\n内容：\n{row['content']}"}
    ])


@app.post("/api/ai/chat")
def ai_chat(req: AIChatRequest):
    system_content = "你是一个智能笔记助手，帮助用户分析和讨论笔记内容。用中文回答。"

    if req.noteId:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM notes WHERE id = ?", (int(req.noteId),)).fetchone()
        if row:
            system_content = (
                f"你是一个智能笔记助手。以下是用户的笔记，请基于此内容回答问题：\n\n"
                f"标题：{row['title']}\n分类：{row['category']}\n\n内容：\n{row['content']}\n\n用中文回答。"
            )

    recent = req.messages[-MAX_CONTEXT_MESSAGES:]
    messages = [{"role": "system", "content": system_content}]
    messages += [{"role": m.role, "content": m.content} for m in recent]

    return stream_completion(messages)


# ── 草莓 陪聊助手 ─────────────────────────────────────────

@app.post("/api/ai/strawberry")
def ai_strawberry(req: StrawberryChatRequest):
    # 只把最近若干条带进上下文，避免单条全局会话无限增长拖慢/超限
    recent = req.messages[-MAX_CONTEXT_MESSAGES:]
    messages = [{"role": "system", "content": STRAWBERRY_PROMPT}]
    messages += [{"role": m.role, "content": m.content} for m in recent]
    return stream_completion(messages)


@app.get("/api/strawberry/chat")
def get_strawberry_history():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT role, content FROM strawberry_messages ORDER BY id"
        ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


@app.post("/api/strawberry/chat", status_code=201)
def add_strawberry_message(msg: ChatMessage):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO strawberry_messages (role, content, created_at) VALUES (?, ?, ?)",
            (msg.role, msg.content, now())
        )
    return {"ok": True}


@app.delete("/api/strawberry/chat")
def clear_strawberry_history():
    with get_db() as conn:
        conn.execute("DELETE FROM strawberry_messages")
    return {"ok": True}


# ── 静态资源 ──────────────────────────────────────────────
# 上传的图片对外服务（须在根路径挂载之前注册，否则会被根路径吞掉）。
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# 若前端已构建（npm run export），则把它挂到根路径。
# 前端源码就在仓库的 frontend/ 子目录，构建产物在 frontend/out。
FRONTEND_DIR = resource_root() / "frontend" / "out"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
